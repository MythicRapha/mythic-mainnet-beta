/* fd_sequencer_tile.c — Mythic L2 Sequencer Tile Implementation

   This tile replaces Tower BFT / PoH in the Firedancer topology.
   It receives verified transactions from upstream quic/verify tiles,
   orders them by fee priority, and produces blocks at a fixed cadence
   (~400 ms).  Blocks are forwarded to the pack/bank tiles for execution.

   All memory lives in fd_wksp scratch — no malloc/free. */

#include "fd_sequencer_tile.h"
#include "fd_sequencer.h"

#include "../../../src/util/fd_util.h"
#include "../../../src/disco/stem/fd_stem.h"
#include "../../../src/disco/metrics/fd_metrics.h"

#include <string.h>
#include <stddef.h>

/* ================================================================== *
 *  Scratch sizing                                                     *
 * ================================================================== */

FD_FN_CONST ulong
fd_sequencer_tile_scratch_align( void ) {
  return FD_SEQUENCER_TILE_ALIGN;
}

FD_FN_CONST ulong
fd_sequencer_tile_scratch_footprint( void ) {
  return FD_SEQUENCER_TILE_FOOTPRINT;
}

/* ================================================================== *
 *  Unprivileged init                                                  *
 * ================================================================== */

void *
fd_sequencer_tile_unprivileged_init( void * scratch,
                                     ulong  scratch_sz ) {
  /* Verify scratch space is large enough */
  ulong required = sizeof(fd_sequencer_tile_t)
                  + FD_SEQUENCER_QUEUE_MAX * sizeof(fd_sequencer_txn_t);
  if( FD_UNLIKELY( scratch_sz < required ) ) {
    FD_LOG_ERR(( "SEQUENCER: scratch too small (%lu < %lu)", scratch_sz, required ));
    return NULL;
  }

  /* Lay out memory:  [ fd_sequencer_tile_t | tx_queue[] ] */
  uchar * mem = (uchar *)scratch;
  fd_sequencer_tile_t * tile = (fd_sequencer_tile_t *)mem;
  mem += sizeof(fd_sequencer_tile_t);

  /* Align the queue buffer */
  mem = (uchar *)fd_ulong_align_up( (ulong)mem, 64UL );

  fd_memset( tile, 0, sizeof(fd_sequencer_tile_t) );

  /* Default config */
  fd_sequencer_cfg_t cfg = FD_SEQUENCER_CFG_DEFAULT;
  tile->cfg = cfg;

  /* Initialize priority queue */
  tile->tx_queue     = (fd_sequencer_txn_t *)mem;
  tile->tx_queue_cnt = 0UL;
  tile->tx_queue_cap = FD_SEQUENCER_QUEUE_MAX;

  /* Slot / epoch state */
  tile->current_slot   = 0UL;
  tile->current_epoch  = 0UL;
  tile->block_count    = 0UL;
  tile->txn_count      = 0UL;
  tile->fee_total      = 0UL;

  /* Initialize parent hash to all zeros (genesis) */
  fd_memset( tile->parent_hash, 0, 32 );

  /* Mark block start */
  tile->block_start_ticks = fd_tickcount();
  tile->last_metrics_ticks = tile->block_start_ticks;

  /* Fragment staging buffer */
  tile->frag_buf_sz = 0UL;

  FD_LOG_NOTICE(( "SEQUENCER: initialized — block_time=%lu ns  max_txns=%lu  epoch_len=%lu",
                  tile->cfg.block_time_ns,
                  tile->cfg.max_txns_per_block,
                  tile->cfg.epoch_length_slots ));

  return tile;
}

/* ================================================================== *
 *  Fragment callbacks                                                 *
 * ================================================================== */

/* during_frag: copy transaction payload from the shared-memory link
   into the tile-local staging buffer.  We don't enqueue yet because
   the data may arrive in multiple chunks (though for SVM transactions
   this is almost always a single chunk). */

void
fd_sequencer_tile_during_frag( void *  ctx,
                               ulong   in_idx,
                               ulong   seq,
                               ulong   sig,
                               ulong   chunk,
                               ulong   sz,
                               int     opt_filter ) {
  (void)in_idx; (void)seq; (void)sig; (void)opt_filter;

  fd_sequencer_tile_t * tile = (fd_sequencer_tile_t *)ctx;

  if( FD_UNLIKELY( sz > FD_SEQUENCER_TXN_MTU ) ) {
    FD_LOG_WARNING(( "SEQUENCER: oversized fragment dropped (%lu > %lu)", sz, (ulong)FD_SEQUENCER_TXN_MTU ));
    tile->frag_buf_sz = 0UL;
    return;
  }

  /* Copy from the shared-memory chunk into our staging buffer.
     In a real Firedancer integration this would use fd_chunk_to_laddr
     to resolve the chunk pointer.  Here we treat chunk as a direct
     pointer for clarity — the topology wiring handles the mapping. */
  fd_memcpy( tile->frag_buf, (void const *)chunk, sz );
  tile->frag_buf_sz = sz;
}

/* after_frag: the full fragment has been received.  Parse the fee out
   of the transaction and insert it into the priority queue. */

void
fd_sequencer_tile_after_frag( void *  ctx,
                              ulong   in_idx,
                              ulong   seq,
                              ulong * opt_sig,
                              ulong * opt_chunk,
                              ulong * opt_sz,
                              ulong * opt_tsorig,
                              int *   opt_filter ) {
  (void)in_idx; (void)seq; (void)opt_sig;
  (void)opt_chunk; (void)opt_sz; (void)opt_tsorig; (void)opt_filter;

  fd_sequencer_tile_t * tile = (fd_sequencer_tile_t *)ctx;

  if( FD_UNLIKELY( tile->frag_buf_sz == 0UL ) ) return;

  /* Build a txn entry from the staging buffer. */
  fd_sequencer_txn_t txn;
  fd_memset( &txn, 0, sizeof(fd_sequencer_txn_t) );
  fd_memcpy( txn.payload, tile->frag_buf, tile->frag_buf_sz );
  txn.payload_sz     = tile->frag_buf_sz;
  txn.received_ticks = fd_tickcount();

  /* Extract the first 64-byte signature from the transaction.
     SVM wire format: [num_sigs(compact-u16)] [sig_0(64B)] ...
     For simplicity we skip the compact-u16 length prefix (1 byte
     for counts < 128) and grab bytes [1..65). */
  if( FD_LIKELY( txn.payload_sz >= 65UL ) ) {
    fd_memcpy( txn.sig, txn.payload + 1, 64 );
  }

  /* Parse fee from the transaction.  In a full implementation this
     would decode the SVM fee payer + compute budget instructions.
     For now, use the priority signal passed via the fragment metadata
     or fall back to the base fee. */
  txn.fee = 5000UL; /* base fee — overridden below if priority info present */

  /* If the upstream verify tile encoded a priority hint in the high
     bits of the fragment sig field, extract it here.  Otherwise keep
     the base fee.  (This integration point will be refined once the
     full SVM transaction decoder is wired up.) */
  if( opt_sig && *opt_sig > 0UL ) {
    txn.fee = *opt_sig;  /* upstream passes fee as sig for ordering hint */
  }

  /* Enqueue into the priority queue */
  if( FD_UNLIKELY( !fd_sequencer_txn_queue_push( tile, &txn ) ) ) {
    FD_LOG_WARNING(( "SEQUENCER: tx queue full (%lu), dropping txn", tile->tx_queue_cnt ));
    tile->frag_buf_sz = 0UL;
    return;
  }

  tile->txn_count++;
  tile->frag_buf_sz = 0UL;
}

/* ================================================================== *
 *  Housekeeping — block production timer                              *
 * ================================================================== */

void
fd_sequencer_tile_during_housekeeping( void * ctx ) {
  fd_sequencer_tile_t * tile = (fd_sequencer_tile_t *)ctx;

  long now = fd_tickcount();

  /* Convert ticks elapsed to nanoseconds.  Firedancer's tick rate is
     roughly 1 tick = 1 ns on modern hardware (fd_tempo_tick_per_ns).
     For portability we use the tick count directly as an approximation
     here; a production build should call fd_tempo_tick_per_ns(). */
  long elapsed_ticks = now - tile->block_start_ticks;
  if( elapsed_ticks < 0 ) elapsed_ticks = 0; /* clock monotonicity guard */

  ulong elapsed_ns = (ulong)elapsed_ticks;

  if( elapsed_ns < tile->cfg.block_time_ns ) return;

  /* ---- Time to produce a block ----------------------------------- */

  /* Allocate txns_out on the stack (bounded by max_txns_per_block,
     but cap at a reasonable stack size).  For very large block sizes
     we clamp to 10000 to avoid blowing the stack. */
  ulong max_txns = tile->cfg.max_txns_per_block;
  if( max_txns > 10000UL ) max_txns = 10000UL;

  fd_sequencer_txn_t txns_out[ 10000 ];
  fd_sequencer_block_hdr_t hdr;
  fd_sha256_t sha_ctx[1];

  uint txn_cnt = fd_sequencer_build_block( tile, &hdr, txns_out, max_txns, sha_ctx );

  /* Update parent hash — sha256 of the full block header */
  fd_sha256_init( sha_ctx );
  fd_sha256_append( sha_ctx, (uchar const *)&hdr, sizeof(fd_sequencer_block_hdr_t) );
  fd_sha256_fini( sha_ctx, tile->parent_hash );

  /* Advance slot and check for epoch boundary */
  int new_epoch = fd_sequencer_advance_slot( tile );

  /* Reset block timer */
  tile->block_start_ticks = now;

  /* Log block production */
  FD_LOG_NOTICE(( "SEQUENCER: slot=%lu txns=%u fees=%lu queue=%lu",
                  hdr.slot, txn_cnt, tile->fee_total,
                  fd_sequencer_txn_queue_cnt( tile ) ));

  if( new_epoch ) {
    FD_LOG_NOTICE(( "SEQUENCER: === epoch %lu started at slot %lu ===",
                    tile->current_epoch, tile->current_slot ));
  }

  /* Publish block to downstream tiles (pack/bank).
     In the full Firedancer integration this would call:

       fd_stem_publish( stem, 0UL, sig, chunk, sz, 0UL, tsorig, tspub );

     where the block data is written into the output mcache/dcache link.
     For now we mark the publish point with a comment — the topology
     wiring in topology-changes.md describes the exact link setup.

     TODO(mythic): wire fd_stem_publish once output links are configured
     in the topology. The block header + transaction payloads would be
     serialized into the output dcache region and published as a single
     fragment or a burst of fragments. */
}

/* ================================================================== *
 *  Metrics                                                            *
 * ================================================================== */

void
fd_sequencer_tile_metrics_write( void * ctx ) {
  fd_sequencer_tile_t * tile = (fd_sequencer_tile_t *)ctx;

  /* In Firedancer, metrics are exposed via the fd_metrics system which
     maps to Prometheus counters/gauges.  The metrics tile periodically
     calls this function to snapshot values.

     FD_MGAUGE_SET( SEQUENCER, CURRENT_SLOT,   tile->current_slot   );
     FD_MGAUGE_SET( SEQUENCER, BLOCK_COUNT,    tile->block_count    );
     FD_MGAUGE_SET( SEQUENCER, TXN_COUNT,      tile->txn_count      );
     FD_MGAUGE_SET( SEQUENCER, QUEUE_DEPTH,    tile->tx_queue_cnt   );
     FD_MGAUGE_SET( SEQUENCER, FEE_TOTAL,      tile->fee_total      );
     FD_MGAUGE_SET( SEQUENCER, CURRENT_EPOCH,  tile->current_epoch  );

     TODO(mythic): register SEQUENCER metric group in fd_metrics.h
     once the tile is integrated into the full build. */

  FD_LOG_NOTICE(( "SEQUENCER METRICS: slot=%lu blocks=%lu txns=%lu queue=%lu fees=%lu epoch=%lu",
                  tile->current_slot,
                  tile->block_count,
                  tile->txn_count,
                  tile->tx_queue_cnt,
                  tile->fee_total,
                  tile->current_epoch ));

  tile->last_metrics_ticks = fd_tickcount();
}

/* ================================================================== *
 *  Finalization                                                       *
 * ================================================================== */

void
fd_sequencer_tile_fini( void * ctx ) {
  fd_sequencer_tile_t * tile = (fd_sequencer_tile_t *)ctx;

  FD_LOG_NOTICE(( "SEQUENCER: shutting down — produced %lu blocks, %lu txns, %lu total fees",
                  tile->block_count, tile->txn_count, tile->fee_total ));

  /* Zero out the private key material */
  fd_memset( tile->sequencer_privkey, 0, 64 );
}

/* fd_sequencer.h — Core sequencer logic (standalone from tile wiring)

   Provides the fee-priority max-heap, block construction, and slot/epoch
   advancement helpers.  All functions operate on caller-owned memory and
   never allocate.  Thread-safety is the caller's responsibility (the tile
   ensures single-writer access). */

#ifndef HEADER_fd_src_sequencer_fd_sequencer_h
#define HEADER_fd_src_sequencer_fd_sequencer_h

#include "fd_sequencer_tile.h"
#include "../../../src/ballet/sha256/fd_sha256.h"
#include "../../../src/ballet/ed25519/fd_ed25519.h"

/* ================================================================== *
 *  Transaction priority queue (max-heap ordered by fee)               *
 * ================================================================== */

/* Push a transaction into the priority queue.
   Returns 1 on success, 0 if the queue is full. */
static inline int
fd_sequencer_txn_queue_push( fd_sequencer_tile_t *     tile,
                             fd_sequencer_txn_t const * txn ) {
  if( FD_UNLIKELY( tile->tx_queue_cnt >= tile->tx_queue_cap ) ) return 0;

  /* Insert at the end and sift up (max-heap by fee). */
  ulong idx = tile->tx_queue_cnt++;
  fd_memcpy( &tile->tx_queue[ idx ], txn, sizeof(fd_sequencer_txn_t) );

  while( idx > 0UL ) {
    ulong parent = ( idx - 1UL ) / 2UL;
    if( tile->tx_queue[ parent ].fee >= tile->tx_queue[ idx ].fee ) break;
    /* swap */
    fd_sequencer_txn_t tmp;
    fd_memcpy( &tmp,                        &tile->tx_queue[ idx    ], sizeof(fd_sequencer_txn_t) );
    fd_memcpy( &tile->tx_queue[ idx    ],   &tile->tx_queue[ parent ], sizeof(fd_sequencer_txn_t) );
    fd_memcpy( &tile->tx_queue[ parent ],   &tmp,                      sizeof(fd_sequencer_txn_t) );
    idx = parent;
  }
  return 1;
}

/* Pop the highest-fee transaction from the queue.
   Writes into *out and returns 1, or returns 0 if the queue is empty. */
static inline int
fd_sequencer_txn_queue_pop( fd_sequencer_tile_t * tile,
                            fd_sequencer_txn_t *  out ) {
  if( FD_UNLIKELY( tile->tx_queue_cnt == 0UL ) ) return 0;

  fd_memcpy( out, &tile->tx_queue[ 0 ], sizeof(fd_sequencer_txn_t) );

  tile->tx_queue_cnt--;
  if( tile->tx_queue_cnt > 0UL ) {
    fd_memcpy( &tile->tx_queue[ 0 ],
               &tile->tx_queue[ tile->tx_queue_cnt ],
               sizeof(fd_sequencer_txn_t) );

    /* Sift down */
    ulong idx = 0UL;
    for(;;) {
      ulong left  = 2UL * idx + 1UL;
      ulong right = 2UL * idx + 2UL;
      ulong best  = idx;

      if( left  < tile->tx_queue_cnt &&
          tile->tx_queue[ left  ].fee > tile->tx_queue[ best ].fee ) best = left;
      if( right < tile->tx_queue_cnt &&
          tile->tx_queue[ right ].fee > tile->tx_queue[ best ].fee ) best = right;
      if( best == idx ) break;

      fd_sequencer_txn_t tmp;
      fd_memcpy( &tmp,                      &tile->tx_queue[ idx  ], sizeof(fd_sequencer_txn_t) );
      fd_memcpy( &tile->tx_queue[ idx  ],   &tile->tx_queue[ best ], sizeof(fd_sequencer_txn_t) );
      fd_memcpy( &tile->tx_queue[ best ],   &tmp,                    sizeof(fd_sequencer_txn_t) );
      idx = best;
    }
  }
  return 1;
}

/* Peek at the highest-fee transaction without removing it.
   Returns pointer to the top element, or NULL if empty. */
static inline fd_sequencer_txn_t const *
fd_sequencer_txn_queue_peek( fd_sequencer_tile_t const * tile ) {
  if( FD_UNLIKELY( tile->tx_queue_cnt == 0UL ) ) return NULL;
  return &tile->tx_queue[ 0 ];
}

/* Return the current number of queued transactions. */
static inline ulong
fd_sequencer_txn_queue_cnt( fd_sequencer_tile_t const * tile ) {
  return tile->tx_queue_cnt;
}

/* ================================================================== *
 *  Block construction                                                 *
 * ================================================================== */

/* Build a block from up to max_txns transactions popped from the
   priority queue.  Fills in *hdr with the block header and populates
   txns_out[] with the included transactions (caller must size to
   max_txns).  Returns the actual number of transactions included.

   The merkle root is computed as sha256( sig_0 || sig_1 || ... ).
   The block header is then signed with the sequencer's ed25519 key.

   Caller supplies a scratch sha256 context via sha_ctx. */
static inline uint
fd_sequencer_build_block( fd_sequencer_tile_t *      tile,
                          fd_sequencer_block_hdr_t * hdr,
                          fd_sequencer_txn_t *       txns_out,
                          ulong                      max_txns,
                          fd_sha256_t *              sha_ctx ) {
  uint n = 0;

  /* Pop transactions from priority queue */
  while( n < (uint)max_txns ) {
    if( !fd_sequencer_txn_queue_pop( tile, &txns_out[ n ] ) ) break;
    n++;
  }

  if( FD_UNLIKELY( n == 0 ) ) {
    /* Empty block — still advance slot but no merkle root to compute */
    fd_memset( hdr, 0, sizeof(fd_sequencer_block_hdr_t) );
    hdr->slot = tile->current_slot;
    fd_memcpy( hdr->parent_hash,     tile->parent_hash,        32 );
    fd_memcpy( hdr->sequencer_pubkey, tile->sequencer_identity, 32 );
    hdr->txn_count = 0;
    return 0;
  }

  /* Compute merkle root = sha256( sig_0 || sig_1 || ... || sig_{n-1} ) */
  fd_sha256_init( sha_ctx );
  for( uint i = 0; i < n; i++ ) {
    fd_sha256_append( sha_ctx, txns_out[ i ].sig, 64 );
  }
  uchar merkle[ 32 ];
  fd_sha256_fini( sha_ctx, merkle );

  /* Fill header */
  hdr->slot      = tile->current_slot;
  hdr->txn_count = n;
  hdr->timestamp = fd_log_wallclock();   /* nanoseconds since UNIX epoch */
  fd_memcpy( hdr->parent_hash,      tile->parent_hash,        32 );
  fd_memcpy( hdr->merkle_root,      merkle,                   32 );
  fd_memcpy( hdr->sequencer_pubkey, tile->sequencer_identity,  32 );

  /* Sign the header (everything except the signature field itself).
     The message to sign is the header bytes up to the signature field. */
  ulong sign_len = offsetof( fd_sequencer_block_hdr_t, signature );
  fd_ed25519_sign( hdr->signature,
                   (uchar const *)hdr,
                   sign_len,
                   tile->sequencer_identity,
                   tile->sequencer_privkey,
                   fd_sha512_new( __builtin_alloca( fd_sha512_align() ) ) );

  /* Accumulate fee total */
  for( uint i = 0; i < n; i++ ) {
    tile->fee_total += txns_out[ i ].fee;
  }

  return n;
}

/* ================================================================== *
 *  Slot / epoch advancement                                           *
 * ================================================================== */

/* Advance the current slot by one.  If the slot crosses an epoch
   boundary, advance current_epoch and return 1.  Otherwise return 0. */
static inline int
fd_sequencer_advance_slot( fd_sequencer_tile_t * tile ) {
  tile->current_slot++;
  tile->block_count++;

  int new_epoch = 0;
  if( tile->current_slot > 0UL &&
      ( tile->current_slot % tile->cfg.epoch_length_slots ) == 0UL ) {
    tile->current_epoch++;
    new_epoch = 1;
  }
  return new_epoch;
}

#endif /* HEADER_fd_src_sequencer_fd_sequencer_h */

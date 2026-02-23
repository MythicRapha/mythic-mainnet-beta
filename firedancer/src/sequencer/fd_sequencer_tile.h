/* fd_sequencer_tile.h — Mythic L2 Sequencer Tile
   Replaces Tower BFT in the Firedancer topology.

   The sequencer receives transactions from net/quic tiles,
   orders them by fee priority, and packs them into blocks
   at configurable intervals (~400ms).  This is a centralized
   sequencer (Phase 1) — the single designated sequencer
   identity signs every block header.

   Memory layout:
     fd_sequencer_tile_t        — tile state (fixed size)
     fd_sequencer_txn_t[cap]    — transaction ring/heap buffer

   All memory is allocated from the tile scratch workspace;
   no malloc/free is ever called. */

#ifndef HEADER_fd_src_sequencer_fd_sequencer_tile_h
#define HEADER_fd_src_sequencer_fd_sequencer_tile_h

#include "../../../src/util/fd_util_base.h"

/* ---- Alignment / footprint macros -------------------------------- */

#define FD_SEQUENCER_TILE_ALIGN     (128UL)
#define FD_SEQUENCER_TILE_FOOTPRINT (1UL << 22) /* 4 MiB scratch   */

#define FD_SEQUENCER_TXN_MTU       (1232UL)     /* max SVM tx size */
#define FD_SEQUENCER_QUEUE_MAX      (65536UL)    /* max pending txns */

/* ---- Configuration ----------------------------------------------- */

struct fd_sequencer_cfg {
  ulong block_time_ns;         /* target block interval  (default 400000000 = 400 ms) */
  ulong max_txns_per_block;    /* hard cap per block     (default 10000)               */
  ulong epoch_length_slots;    /* slots per epoch        (default 432000)              */
};
typedef struct fd_sequencer_cfg fd_sequencer_cfg_t;

#define FD_SEQUENCER_CFG_DEFAULT {  \
  .block_time_ns       = 400000000UL, \
  .max_txns_per_block  = 10000UL,     \
  .epoch_length_slots  = 432000UL,    \
}

/* ---- Transaction entry (heap element) ---------------------------- */

struct fd_sequencer_txn {
  uchar   payload[ FD_SEQUENCER_TXN_MTU ]; /* raw SVM transaction bytes     */
  ulong   payload_sz;                       /* actual size (<= MTU)          */
  ulong   fee;                              /* fee in lamports (sort key)    */
  long    received_ticks;                   /* fd_tickcount() at arrival     */
  uchar   sig[ 64 ];                        /* first ed25519 signature       */
};
typedef struct fd_sequencer_txn fd_sequencer_txn_t;

/* ---- Block header ------------------------------------------------ */

struct fd_sequencer_block_hdr {
  ulong   slot;                              /* monotonic slot number        */
  uchar   parent_hash[ 32 ];                 /* hash of the previous block   */
  uchar   merkle_root[ 32 ];                 /* sha256(concat(tx sigs))      */
  long    timestamp;                          /* wallclock ns (UNIX epoch)    */
  uchar   sequencer_pubkey[ 32 ];            /* ed25519 public key           */
  uint    txn_count;                          /* number of transactions       */
  uchar   signature[ 64 ];                   /* ed25519 over header fields   */
};
typedef struct fd_sequencer_block_hdr fd_sequencer_block_hdr_t;

/* ---- Tile state -------------------------------------------------- */

struct fd_sequencer_tile {
  /* Sequencer identity */
  uchar   sequencer_identity[ 32 ];          /* ed25519 pubkey               */
  uchar   sequencer_privkey[ 64 ];           /* ed25519 keypair (priv+pub)   */

  /* Block production state */
  ulong   current_slot;
  ulong   current_epoch;
  ulong   block_count;
  ulong   txn_count;                         /* lifetime tx counter          */
  long    block_start_ticks;                  /* tick when current block began*/
  uchar   parent_hash[ 32 ];                 /* hash of last produced block  */

  /* Transaction priority queue (max-heap by fee) */
  fd_sequencer_txn_t * tx_queue;             /* points into scratch mem      */
  ulong   tx_queue_cnt;                      /* current number of entries    */
  ulong   tx_queue_cap;                      /* allocated capacity           */

  /* Aggregate metrics */
  ulong   fee_total;                         /* sum of all fees collected     */
  long    last_metrics_ticks;                /* last metrics snapshot tick    */

  /* Cached config */
  fd_sequencer_cfg_t cfg;

  /* Temporary staging buffer for in-flight fragment */
  uchar   frag_buf[ FD_SEQUENCER_TXN_MTU ];
  ulong   frag_buf_sz;
};
typedef struct fd_sequencer_tile fd_sequencer_tile_t;

/* ---- Tile lifecycle API ------------------------------------------ */

FD_FN_CONST ulong
fd_sequencer_tile_scratch_align( void );

FD_FN_CONST ulong
fd_sequencer_tile_scratch_footprint( void );

/* Called once after workspace allocation.  Reads config from
   fd_topo_tile_t and initializes all state.  Returns ctx pointer
   stored by fd_stem for later callbacks. */
void *
fd_sequencer_tile_unprivileged_init( void * scratch,
                                     ulong  scratch_sz );

/* fd_stem fragment callbacks */
void
fd_sequencer_tile_during_frag( void *                 ctx,
                               ulong                  in_idx,
                               ulong                  seq,
                               ulong                  sig,
                               ulong                  chunk,
                               ulong                  sz,
                               int                    opt_filter );

void
fd_sequencer_tile_after_frag( void *  ctx,
                              ulong   in_idx,
                              ulong   seq,
                              ulong * opt_sig,
                              ulong * opt_chunk,
                              ulong * opt_sz,
                              ulong * opt_tsorig,
                              int *   opt_filter );

/* Periodic housekeeping — drives block production timer. */
void
fd_sequencer_tile_during_housekeeping( void * ctx );

/* Expose Prometheus-compatible metrics. */
void
fd_sequencer_tile_metrics_write( void * ctx );

/* Graceful shutdown. */
void
fd_sequencer_tile_fini( void * ctx );

#endif /* HEADER_fd_src_sequencer_fd_sequencer_tile_h */

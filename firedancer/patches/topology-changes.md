# Firedancer Topology Changes for Mythic L2

This document describes every modification required in the Firedancer source tree
to replace Tower BFT / PoH consensus with the Mythic L2 centralized sequencer tile.

Target Firedancer version: **v0.812.30108**

---

## 1. New Tile Type: `FD_TOPO_TILE_SEQUENCER`

### File: `src/disco/topo/fd_topo.h`

Add the sequencer tile type to the tile enumeration:

```c
/* After the existing tile types (e.g. FD_TOPO_TILE_NET, FD_TOPO_TILE_QUIC, ...) */
#define FD_TOPO_TILE_SEQUENCER  (17)   /* Mythic L2 sequencer (replaces PoH + Tower) */
```

Add the tile name mapping in `fd_topo_tile_kind_str()`:

```c
case FD_TOPO_TILE_SEQUENCER: return "sequencer";
```

---

## 2. Tile Array Registration

### File: `src/app/fdctl/topology.c`

In the function that builds the tile topology array (typically
`fd_topo_create_tiles()` or similar), add the sequencer tile and remove
the consensus-related tiles.

**Remove these tile registrations:**
- `FD_TOPO_TILE_POH`     — Proof of History generator (replaced by sequencer timer)
- `FD_TOPO_TILE_TOWER`   — Tower BFT voter (not needed — single sequencer)
- `FD_TOPO_TILE_GOSSIP`  — Gossip protocol (L2 does not gossip with Solana validators)
- `FD_TOPO_TILE_REPAIR`  — Block repair (single sequencer, no repair needed)
- `FD_TOPO_TILE_TURBINE` — Turbine shred distribution (replaced by direct feed)

**Add:**
```c
{
  .kind             = FD_TOPO_TILE_SEQUENCER,
  .name             = "sequencer",
  .in_cnt           = 2,                          /* quic_verify -> sequencer (x2 verify tiles) */
  .out_cnt          = 1,                          /* sequencer -> pack */
  .scratch_align    = fd_sequencer_tile_scratch_align(),
  .scratch_footprint = fd_sequencer_tile_scratch_footprint(),
}
```

---

## 3. Tile Registration in `run.c`

### File: `src/app/fdctl/run/run.c`

In the tile dispatch table (the large `switch` statement in the run
loop), add the sequencer case:

```c
case FD_TOPO_TILE_SEQUENCER: {
  fd_stem_tile_t stem_tile = {
    .during_frag_fn      = fd_sequencer_tile_during_frag,
    .after_frag_fn       = fd_sequencer_tile_after_frag,
    .during_housekeeping_fn = fd_sequencer_tile_during_housekeeping,
    .metrics_write_fn    = fd_sequencer_tile_metrics_write,
  };

  void * ctx = fd_sequencer_tile_unprivileged_init(
    tile->scratch,
    tile->scratch_footprint
  );

  fd_stem_run( &stem_tile, ctx, ... );
  break;
}
```

**Include at top of file:**
```c
#include "../../sequencer/fd_sequencer_tile.h"
```

---

## 4. Link Wiring

The sequencer tile sits between the verify tiles (input) and the pack
tile (output) in the data flow:

```
net -> quic -> verify_0 -+-> SEQUENCER -> pack -> bank_0
                verify_1 -+                       bank_1
                                                  bank_2
                                                  bank_3
                                                        |
                                                        v
                                                      store
```

### Input Links (verify -> sequencer)

Each verify tile has an output `mcache`/`dcache` pair.  The sequencer
subscribes to all verify tile outputs:

```c
/* In topology.c link wiring section */
for( ulong i = 0; i < verify_tile_cnt; i++ ) {
  fd_topo_link_t * link = fd_topo_link_new(
    topo,
    verify_tiles[i],    /* producer */
    sequencer_tile,     /* consumer */
    FD_TOPO_LINK_KIND_MCACHE,
    64UL * 1024UL,      /* depth */
    FD_SEQUENCER_TXN_MTU /* mtu */
  );
}
```

### Output Links (sequencer -> pack)

The sequencer publishes ordered blocks to the pack tile:

```c
fd_topo_link_t * seq_to_pack = fd_topo_link_new(
  topo,
  sequencer_tile,
  pack_tile,
  FD_TOPO_LINK_KIND_MCACHE,
  128UL * 1024UL,       /* larger depth for block data */
  1UL << 16             /* 64 KiB mtu for block fragments */
);
```

---

## 5. Tiles to Remove

The following tiles and their associated links should be removed from
the topology for Mythic L2, since a centralized sequencer replaces
distributed consensus:

| Tile | Reason for Removal |
|------|--------------------|
| `poh` (Proof of History) | Block timing is driven by the sequencer's `block_time_ns` timer, not a SHA-256 hash chain |
| `tower` (Tower BFT) | No voting; single sequencer signs blocks |
| `gossip` | L2 does not participate in Solana's gossip protocol |
| `repair` | Single sequencer, so no block repair protocol needed |
| `turbine` (shred) | Blocks are not shredded for turbine propagation; they are sent directly from sequencer to pack |
| `vote` | No vote transactions on L2 |

Removing these tiles also eliminates their associated shared-memory
links, significantly reducing the workspace memory footprint.

---

## 6. Config Changes

### File: `src/app/fdctl/config.c`

Add parsing for the `[consensus]` and `[mythic]` sections of
`mythic_config.toml`:

```c
/* In fd_config_load() or equivalent */
if( fd_toml_has_section( toml, "consensus" ) ) {
  cfg->consensus_type = fd_toml_get_str( toml, "consensus.type", "tower_bft" );
  if( 0 == strcmp( cfg->consensus_type, "sequencer" ) ) {
    cfg->sequencer.block_time_ns =
      fd_toml_get_ulong( toml, "consensus.block_time_ms", 400 ) * 1000000UL;
    cfg->sequencer.max_txns_per_block =
      fd_toml_get_ulong( toml, "consensus.max_transactions_per_block", 10000 );
    cfg->sequencer.epoch_length_slots =
      fd_toml_get_ulong( toml, "consensus.epoch_length_slots", 432000 );
  }
}
```

Add a config struct member in the Firedancer config header:

```c
/* In fd_config.h (or wherever FD's config struct lives) */
struct fd_config {
  /* ... existing fields ... */
  char const *         consensus_type;    /* "sequencer" | "tower_bft" */
  fd_sequencer_cfg_t   sequencer;         /* only used if type=="sequencer" */
};
```

---

## 7. Build System Changes

### File: `Makefile` (or `src/sequencer/Local.mk`)

Add the sequencer source files to the build:

```makefile
# Mythic L2 sequencer tile
$(call add-objs, src/sequencer/fd_sequencer_tile, fd_disco)
$(call add-hdrs, src/sequencer/fd_sequencer_tile.h src/sequencer/fd_sequencer.h)
```

Ensure the sequencer object is linked into the `fdctl` binary.

---

## 8. Identity / Keypair Loading

The sequencer needs an ed25519 keypair to sign block headers.  This is
loaded from the existing Firedancer identity keypair file
(`/etc/firedancer/identity.json` or as configured).

In `fd_sequencer_tile_unprivileged_init`, after reading the keypair:

```c
/* Load identity keypair from the standard Firedancer location */
fd_keyload_load( tile_cfg->identity_key_path,
                 tile->sequencer_privkey,
                 64 );
fd_memcpy( tile->sequencer_identity, tile->sequencer_privkey + 32, 32 );
```

---

## 9. Metrics Registration

### File: `src/disco/metrics/fd_metrics.h`

Add the SEQUENCER metric group:

```c
#define FD_METRICS_SEQUENCER(X) \
  X( CURRENT_SLOT,    "sequencer_current_slot",    GAUGE, "Current slot number" ) \
  X( BLOCK_COUNT,     "sequencer_block_count",     COUNTER, "Total blocks produced" ) \
  X( TXN_COUNT,       "sequencer_txn_count",       COUNTER, "Total transactions sequenced" ) \
  X( QUEUE_DEPTH,     "sequencer_queue_depth",     GAUGE, "Pending transactions in queue" ) \
  X( FEE_TOTAL,       "sequencer_fee_total",       COUNTER, "Cumulative fees collected" ) \
  X( CURRENT_EPOCH,   "sequencer_current_epoch",   GAUGE, "Current epoch number" )
```

---

## 10. Summary of Changed Files

| File | Action |
|------|--------|
| `src/disco/topo/fd_topo.h` | Add `FD_TOPO_TILE_SEQUENCER` |
| `src/app/fdctl/topology.c` | Add sequencer tile, remove poh/tower/gossip/repair/turbine |
| `src/app/fdctl/run/run.c` | Register sequencer callbacks |
| `src/app/fdctl/config.c` | Parse `[consensus]` config section |
| `src/disco/metrics/fd_metrics.h` | Add SEQUENCER metric group |
| `Makefile` / `Local.mk` | Add sequencer sources to build |
| `src/sequencer/fd_sequencer_tile.h` | **New file** — tile header |
| `src/sequencer/fd_sequencer.h` | **New file** — core logic |
| `src/sequencer/fd_sequencer_tile.c` | **New file** — tile implementation |

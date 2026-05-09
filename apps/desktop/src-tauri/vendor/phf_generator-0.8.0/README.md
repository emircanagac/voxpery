# phf_generator 0.8.0 patch

This is a minimal local patch of `phf_generator` 0.8.0 for the desktop build.

The upstream crate is MIT licensed and originally comes from:

https://github.com/sfackler/rust-phf

Only the `rand` dependency is changed from the vulnerable `0.7.x` line to
`0.8.6`. Remove this patch once the upstream Tauri HTML parsing dependency
chain no longer resolves `phf_generator` 0.8.0 with `rand` 0.7.x.

# Public-domain samples

`alice.txt` is the UTF-8 Alice in Wonderland research input. `alice-neural.nzip` is its complete model archive (63,048 bytes for 151,094 original bytes).

`library-neural.nzip` is the complete five-book research archive (791,134 bytes for 3,120,899 original bytes).

Both use the raw Neurzip v1 envelope. Migration changed container metadata only; learned weight and arithmetic stream bytes were preserved. Both have been fully decoded and verified. Source hashes and complete sizes are in `../benchmarks.json`. They use completed research models and are not promises for a 30-second browser training run. No outer conventional compression is used.

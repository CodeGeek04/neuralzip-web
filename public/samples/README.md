# Public-domain samples

`alice.txt` is the UTF-8 Alice in Wonderland research input. `alice-neural.nzip` is its complete model archive (63,048 bytes for 151,094 original bytes).

`library-neural.nzip` is the complete five-book research archive (791,134 bytes for 3,120,899 original bytes).

Both use the raw Neuralzip v1 envelope. Migration changed container metadata only; learned weight and arithmetic stream bytes were preserved. Both have been fully decoded and verified. Source hashes and complete sizes are in `../benchmarks.json`. They use completed research models and are not promises for a 30-second browser training run. No outer conventional compression is used.

`modest-proposal.nzip` and `yellow-wallpaper.nzip` use existing trained models of Jonathan Swift's *A Modest Proposal* and Charlotte Perkins Gilman's *The Yellow Wallpaper*. Their original q8 weight bytes are unchanged. Arithmetic streams were encoded against the original source bytes and each complete archive was decoded and SHA-256 verified. They are public-domain works; sizes, source hashes and provenance are in `data/prepared-books.json` in the source repository.

The short encoder examples include a 12 KB Alice excerpt, generated JSON Lines and a multilingual text example. Selecting an encoding example trains a new model locally; selecting a decode book uses its already trained model.

Game SFX prefer CC0 WAV samples in this folder (loaded via fetch +
AudioContext.decodeAudioData in src/audio/gameSfx.ts). Quiet synth
fallbacks keep the game working if a sample fails to load.

Samples:
  card_shuffle.wav, card_shuffle_bridge.wav — shuffle
  card_play1.wav, card_play2.wav — deal / plain card play (cardboard slap)
  card_cut.wav — cut-for-deal + starter cut; also soft crib discard tap (quieter)
  peg_wood.wav, peg1.wav, peg2.wav, peg3.wav — peg wood tick (scoring pegs only)

See CREDITS.txt for OpenGameArt CC0 sources (BMacZero + Wuzzy).

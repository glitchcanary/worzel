<?xml version="1.0" encoding="UTF-8"?>
<!--
  ElevenLabs Pronunciation Dictionary for Radio Foundation Quiz.

  Upload to ElevenLabs when story content changes:
    curl -X POST "https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file" \
      -H "xi-api-key: $WORZEL_ELEVENLABS_API_KEY" \
      -F 'name=fink-radio-terms' \
      -F 'file=@stories/radio-foundation-quiz/pronunciation.pls'

  Then set the returned dictionary ID:
    fly secrets set ELEVENLABS_PRONUNCIATION_DICT_IDS=<id> -a worzel

  Or for local dev, add to .env:
    ELEVENLABS_PRONUNCIATION_DICT_IDS=<id>
-->
<lexicon version="1.0" xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" alphabet="ipa" xml:lang="en-US">
  <!-- Frequency units -->
  <lexeme><grapheme>MHz</grapheme><alias>megahertz</alias></lexeme>
  <lexeme><grapheme>GHz</grapheme><alias>gigahertz</alias></lexeme>
  <lexeme><grapheme>kHz</grapheme><alias>kilohertz</alias></lexeme>

  <!-- Radio acronyms -->
  <lexeme><grapheme>RF</grapheme><alias>R F</alias></lexeme>
  <lexeme><grapheme>HF</grapheme><alias>H F</alias></lexeme>
  <lexeme><grapheme>VHF</grapheme><alias>V H F</alias></lexeme>
  <lexeme><grapheme>UHF</grapheme><alias>U H F</alias></lexeme>
  <lexeme><grapheme>SWR</grapheme><alias>S W R</alias></lexeme>
  <lexeme><grapheme>SSB</grapheme><alias>S S B</alias></lexeme>
  <lexeme><grapheme>CW</grapheme><alias>C W</alias></lexeme>
  <lexeme><grapheme>FM</grapheme><alias>F M</alias></lexeme>
  <lexeme><grapheme>AM</grapheme><alias>A M</alias></lexeme>

  <!-- Measurement -->
  <lexeme><grapheme>dB</grapheme><alias>decibels</alias></lexeme>
  <lexeme><grapheme>EMF</grapheme><alias>E M F</alias></lexeme>
  <lexeme><grapheme>RST</grapheme><alias>R S T</alias></lexeme>

  <!-- Q codes -->
  <lexeme><grapheme>QTH</grapheme><alias>Q T H</alias></lexeme>
  <lexeme><grapheme>QSY</grapheme><alias>Q S Y</alias></lexeme>
  <lexeme><grapheme>QRZ</grapheme><alias>Q R Z</alias></lexeme>
  <lexeme><grapheme>QSL</grapheme><alias>Q S L</alias></lexeme>
  <lexeme><grapheme>QRM</grapheme><alias>Q R M</alias></lexeme>
  <lexeme><grapheme>QRN</grapheme><alias>Q R N</alias></lexeme>
  <lexeme><grapheme>QRX</grapheme><alias>Q R X</alias></lexeme>

  <!-- Technical terms -->
  <lexeme><grapheme>CTCSS</grapheme><alias>C T C S S</alias></lexeme>
  <lexeme><grapheme>TVI</grapheme><alias>T V I</alias></lexeme>
  <lexeme><grapheme>BCI</grapheme><alias>B C I</alias></lexeme>

  <!-- Organisations and proper nouns -->
  <lexeme><grapheme>Ofcom</grapheme><alias>Off-com</alias></lexeme>
  <lexeme><grapheme>RSGB</grapheme><alias>R S G B</alias></lexeme>

  <!-- Callsign prefixes -->
  <lexeme><grapheme>M7</grapheme><alias>M 7</alias></lexeme>
  <lexeme><grapheme>M0</grapheme><alias>M zero</alias></lexeme>
  <lexeme><grapheme>2E0</grapheme><alias>2 E zero</alias></lexeme>
  <lexeme><grapheme>G4</grapheme><alias>G 4</alias></lexeme>
</lexicon>

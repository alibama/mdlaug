# mDLAUG MED1  |  Level A  |  WCAG 1.2.1, 1.2.2, 1.2.3
# Interaction elements: Video, Audio, Embedded player
# Engine rule(s): media-captions
Feature: MED1 — Multimedia captions and transcripts (beyond the 24)
  As a screen-reader or low-vision user
  I want video and audio to have captions and a transcript
  So that I can access multimedia content

  @core @algorithmic @implemented
  Scenario: Uncaptioned media is detected and, with a service, captioned
    Given a <video>/<audio> with no captions track, or a YouTube/Vimeo embed
    When the page is remediated
    Then the player is named and flagged
    And with a transcription service, a WebVTT caption track and a visible transcript are added and labelled unverified
    And third-party embeds are flagged with guidance

  # Additional guideline [hybrid / service]: Provide captions/subtitles for video.
  #   Detection, player naming, and building a WebVTT track from returned segments are algorithmic; the transcription itself is a service (or authored captions).

  # Additional guideline [hybrid / service]: Provide a transcript for audio and video.
  #   The transcript panel is injected algorithmically; its text comes from a transcription service or is authored.

  # Additional guideline [manual / manual]: Provide audio description for video.
  #   Described-video narration is authored/produced content.


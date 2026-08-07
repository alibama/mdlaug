# mDLAUG FIL3/HEP1  |  Level A  |  WCAG 4.1.2
# Interaction elements: Help control, Help region
# Engine rule(s): help-affordance
Feature: FIL3/HEP1 — Difficulty finding/locating/using mobile-specific help information
  As a screen-reader or low-vision user
  I want help to be findable and usable
  So that I can get assistance when stuck

  @core @algorithmic @implemented
  Scenario: A help affordance is exposed
    Given a help/FAQ control
    When the page is remediated
    Then the help control is named and reachable

  # Additional guideline [manual / app-layer]: Provide contextual help that adapts to the current task.
  #   Task-aware help is an application feature.

  # Additional guideline [hybrid / service]: Include short accessible video or audio tutorials.
  #   Authoring the tutorials is manual; captioning/transcribing them is algorithmic via the media rule (MED1) with a transcription service.

  # Additional guideline [manual / app-layer]: Offer searchable help documentation.
  #   A documentation/search feature.


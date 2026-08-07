# mDLAUG EXE2  |  Level A  |  WCAG 2.1.2, 4.1.2
# Interaction elements: Dialog/Modal, Close button
# Engine rule(s): dialog-escape
Feature: EXE2 — Difficulty exiting an open item
  As a screen-reader or low-vision user
  I want a way out of any open item or modal by button and Escape, with focus managed
  So that I never get trapped

  @core @algorithmic @implemented
  Scenario: A modal gets exit semantics
    Given an open modal with no aria-modal and no keyboard close
    When the page is remediated
    Then the dialog gets role=dialog/aria-modal, a labelled close control, and Escape closes it

  # Additional guideline [hybrid / proposed]: Restore the user's previous reading position automatically.
  #   The extension can remember scroll/focus position on open and restore it on close — within-session, algorithmic.

  # Additional guideline [algorithmic / implemented]: Provide multiple exit methods (Back, Close, Escape gesture, voice command).
  #   Escape-to-close and a labelled Close control are added; voice is provided by the assistive technology once the control is named.

  # Additional guideline [manual / app-layer]: Warn users before leaving when annotations or edits may be lost.
  #   The app must signal that unsaved state exists.


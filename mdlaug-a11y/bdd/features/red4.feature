# mDLAUG RED4  |  Level AAA  |  WCAG 4.1.2
# Interaction elements: Restricted control, Disabled control
# Engine rule(s): authorized-features
Feature: RED4 — Difficulty recognizing authorized features
  As a screen-reader or low-vision user
  I want restricted controls to announce that they're unavailable and why
  So that I don't waste effort on features I can't use

  @core @algorithmic @implemented
  Scenario: A restricted control is marked
    Given a control that is visually gated/locked
    When the page is remediated
    Then the control is marked unavailable (aria-disabled) with its reason if detectable

  # Additional guideline [hybrid / proposed]: Explain why a feature is unavailable.
  #   If a reason (e.g. "log in to access") is present nearby, associate it; otherwise the reason must be authored.

  # Additional guideline [manual / manual]: Indicate what actions are needed to gain access.
  #   The required-action text is authored content.

  # Additional guideline [algorithmic / implemented]: Avoid presenting inaccessible controls as fully interactive.
  #   Gated controls are marked aria-disabled so AT doesn't present them as operable.


# mDLAUG FIL1  |  Level A  |  WCAG 4.1.2
# Interaction elements: Icon button, Search control
# Engine rule(s): icon-buttons
Feature: FIL1 — Difficulty finding/locating an icon-based search feature
  As a screen-reader or low-vision user
  I want icon-only controls (like a magnifier) to have names
  So that I can find and use them

  @core @algorithmic @implemented
  Scenario: An icon-only button is named
    Given a button whose only content is an icon glyph
    When the page is remediated
    Then the button gets a sensible accessible name (e.g. "Search")


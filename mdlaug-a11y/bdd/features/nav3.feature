# mDLAUG NAV3  |  Level AA  |  WCAG 4.1.3
# Interaction elements: Results region, Live region
# Engine rule(s): results-status
Feature: NAV3 — Difficulty navigating through search results
  As a screen-reader or low-vision user
  I want result updates and structure announced as I move through them
  So that I can navigate results confidently

  @core @algorithmic @implemented
  Scenario: The results region announces status
    Given a results container that updates dynamically
    When the page is remediated
    Then a polite live region announces result availability and updates


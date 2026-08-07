# mDLAUG NAV5  |  Level A  |  WCAG 4.1.3
# Interaction elements: Skip link, Results region
# Engine rule(s): results-status
Feature: NAV5 — Difficulty navigating to a search result section
  As a screen-reader or low-vision user
  I want a shortcut to the results and a focus move when results arrive
  So that I can get to results quickly

  @core @algorithmic @implemented
  Scenario: A skip-to-results shortcut is added
    Given a page with a results section below filters
    When the page is remediated
    Then a "Skip to search results" link is provided

  @guideline @algorithmic @proposed
  Scenario: Focus moves to results on search
    Given a search that reloads or updates results
    And the move-focus option enabled
    When a search completes
    Then focus is placed on the results region and the count is announced

  # Additional guideline [algorithmic / implemented]: Announce the location and number of search results.
  #   The results-status live region announces availability/count.

  # Additional guideline [algorithmic / implemented]: Provide a "Skip to search results" shortcut.
  #   A skip-to-results link is injected.


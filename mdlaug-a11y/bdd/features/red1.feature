# mDLAUG RED1  |  Level A  |  WCAG 4.1.3
# Interaction elements: Results region, Live region, Status
# Engine rule(s): results-status
Feature: RED1 — Difficulty recognizing the availability of search results
  As a screen-reader or low-vision user
  I want clear, announced status for searching, results, no-results, and errors
  So that I know what's happening

  @core @algorithmic @implemented
  Scenario: Result availability is announced
    Given a results container
    When the page is remediated
    Then a polite live region announces when results are available or updated

  # Additional guideline [hybrid / proposed]: Provide progressive feedback during long-running searches.
  #   If a loading state is detectable in the DOM, announce "searching…"; otherwise the app must signal progress.

  # Additional guideline [hybrid / app-layer]: Clearly distinguish "no results" from loading or network errors.
  #   The tool can label a detectable empty state as "no results", but distinguishing an error requires the app's state.

  # Additional guideline [algorithmic / implemented]: Announce when search results have been updated dynamically.
  #   The live region announces dynamic updates.


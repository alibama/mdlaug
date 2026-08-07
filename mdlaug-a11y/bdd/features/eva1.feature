# mDLAUG EVA1  |  Level A  |  WCAG 2.4.4
# Interaction elements: Result item, Snippet, Link
# Engine rule(s): result-relevance
Feature: EVA1 — Difficulty assessing relevance of a collection or an item
  As a screen-reader or low-vision user
  I want result titles and snippets that make each item's relevance clear
  So that I can decide what to open

  @core @algorithmic @implemented
  Scenario: Result items get descriptive link semantics
    Given a list of result rows
    When the page is remediated
    Then each result's primary link has a meaningful accessible name

  # Additional guideline [manual / app-layer]: Explain why an item appears in search results.
  #   Match rationale comes from the search engine.

  @guideline @algorithmic @proposed
  Scenario: Query terms are highlighted in snippets
    Given a results page reached with a query "harbor"
    When the page is remediated
    Then occurrences of "harbor" in each snippet are marked and announced as highlighted

  # Additional guideline [hybrid / service]: Provide AI-generated summaries that explain an item's relevance.
  #   A model can draft a relevance summary (service); the trigger/labelling is algorithmic.


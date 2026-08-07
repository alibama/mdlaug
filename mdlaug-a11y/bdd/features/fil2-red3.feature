# mDLAUG FIL2/RED3  |  Level AA  |  WCAG 1.3.1
# Interaction elements: Search region, Search input
# Engine rule(s): search-regions
Feature: FIL2/RED3 — Difficulty finding/locating/distinguishing search features at different levels
  As a screen-reader or low-vision user
  I want each search feature clearly scoped and labelled
  So that I know what I'm searching

  @core @algorithmic @implemented
  Scenario: Search controls are grouped into labelled regions
    Given multiple search inputs at different scopes
    When the page is remediated
    Then each search is placed in a labelled search region

  # Additional guideline [hybrid / proposed]: Clearly announce the scope of every search (site, collection, results).
  #   Where scope is inferable from the input's placeholder/label/container, the tool can add a scope to the accessible name; otherwise authored.

  # Additional guideline [manual / app-layer]: Allow users to switch search scope without losing entered queries.
  #   Query preservation across scope changes is application behaviour.

  # Additional guideline [manual / manual]: Maintain consistent terminology across all search interfaces.
  #   Authoring/content policy.


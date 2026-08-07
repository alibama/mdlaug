# mDLAUG COM2/NAV1  |  Level AAA  |  WCAG 1.3.1
# Interaction elements: Facet region, Checkbox group, Filter chip
# Engine rule(s): filter-groups
Feature: COM2/NAV1 — Difficulty understanding/navigating the search filtering structure
  As a screen-reader or low-vision user
  I want the filter panel exposed as a labelled region with grouped controls
  So that I can understand and operate the filters

  @core @algorithmic @implemented
  Scenario: A facet panel becomes a labelled region
    Given a filters sidebar with no region semantics
    When the page is remediated
    Then the panel gets role=region with an accessible label and grouped controls

  # Additional guideline [hybrid / proposed]: Display currently applied filters in an easily reviewable summary.
  #   Active filter chips present in the DOM can be collected into a labelled "applied filters" summary region (algorithmic); if the app doesn't render them, it's app-layer.

  # Additional guideline [manual / manual]: Explain how each filter affects search results.
  #   Explanatory content is authored.

  # Additional guideline [hybrid / proposed]: Provide one-click removal of individual filters and "Clear all filters."
  #   Where removable filter chips exist, the tool can ensure each has an accessible remove control and add a "Clear all"; wiring removal to the app is app-layer.


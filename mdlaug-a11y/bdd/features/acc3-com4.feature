# mDLAUG ACC3/COM4  |  Level AA  |  WCAG 1.1.1
# Interaction elements: SVG chart, Canvas, Image chart
# Engine rule(s): graphs-longdesc
Feature: ACC3/COM4 — Difficulty accessing/comprehending graphs
  As a screen-reader or low-vision user
  I want a graph's data and meaning available as text and as a table
  So that I can understand the data without seeing the chart

  @core @algorithmic @implemented
  Scenario: A graph is exposed as needing a data description
    Given a chart rendered as SVG/canvas/image
    When the page is remediated
    Then the graph is given role=img and flagged as needing a data description/table

  # Additional guideline [hybrid / app-layer]: Provide downloadable data tables corresponding to every graph.
  #   If the underlying data is present in the DOM (e.g. an SVG's data attributes or an adjacent hidden table) the tool can extract and surface it; a chart rendered as a flat image has no data to extract, so the author/app must supply the table.

  # Additional guideline [manual / service]: Present textual summaries highlighting trends, comparisons, and outliers.
  #   Requires analysis of the data; a model can draft a summary (service), otherwise authored.

  # Additional guideline [manual / app-layer]: Allow users to ask natural-language questions about graph content.
  #   A Q&A interface over the data is an application feature, not a DOM remediation.


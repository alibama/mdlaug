# mDLAUG NAV4  |  Level AA  |  WCAG 2.4.1, 2.4.5
# Interaction elements: Heading, In-item TOC, Jump link
# Engine rule(s): within-item-nav
Feature: NAV4 — Difficulty navigating within an item
  As a screen-reader or low-vision user
  I want an automatic table of contents and heading navigation inside a document
  So that I can jump around a long item

  @core @algorithmic @implemented
  Scenario: An in-item contents list is generated
    Given a long item with a heading outline
    When the page is remediated (or opened in the Reading Room)
    Then a Contents list of jump links to the item's headings is provided

  # Additional guideline [hybrid / proposed]: Allow users to bookmark sections within documents.
  #   Within-session anchors/bookmarks are algorithmic; persistent cross-session bookmarks are app-layer.

  # Additional guideline [hybrid / service]: Provide automatically generated tables of contents for OCR documents.
  #   TOC-from-headings is algorithmic (implemented); an OCR document first needs OCR (service) to recover headings.

  # Additional guideline [algorithmic / implemented]: Support heading navigation even in converted documents.
  #   The converter/Reading Room preserves real headings, so AT heading navigation works on converted content.


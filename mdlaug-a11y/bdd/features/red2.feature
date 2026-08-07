# mDLAUG RED2  |  Level AA  |  WCAG 1.3.1
# Interaction elements: Thumbnail image, Title, Figure group
# Engine rule(s): images-alt
Feature: RED2 — Difficulty distinguishing collection titles from thumbnails
  As a screen-reader or low-vision user
  I want titles read before decorative thumbnails, cleanly separated
  So that I hear the title, not image noise

  @core @algorithmic @implemented
  Scenario: Decorative thumbnails are hidden and titles kept
    Given result cards where a thumbnail duplicates the title link
    When the page is remediated
    Then purely decorative thumbnails are hidden from AT so the title is what's announced

  # Additional guideline [algorithmic / implemented]: Allow users to suppress decorative images entirely.
  #   Decorative/duplicative thumbnails are hidden with aria-hidden; a global suppress toggle is a small proposed extension.

  # Additional guideline [hybrid / proposed]: Present titles before thumbnail descriptions consistently.
  #   Reading order can be corrected with aria-describedby/ordering; visual reordering is riskier and left to the app.

  # Additional guideline [hybrid / proposed]: Separate title and image description with semantic grouping.
  #   Wrapping a title+image pair in a figure/group with a caption is algorithmic where the pairing is unambiguous.


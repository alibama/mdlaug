# mDLAUG NAV2  |  Level AA  |  WCAG 1.3.1, 2.4.1
# Interaction elements: Pagination, Page link
# Engine rule(s): pagination
Feature: NAV2 — Difficulty navigating paginated sections
  As a screen-reader or low-vision user
  I want pagination exposed as a labelled nav landmark with the current page marked
  So that I can move between pages

  @core @algorithmic @implemented
  Scenario: A pager becomes a labelled landmark
    Given a pagination control with no nav semantics
    When the page is remediated
    Then the pager gets role=navigation with a label and the active page gets aria-current=page

  # Additional guideline [manual / app-layer]: Allow users to choose between pagination and continuous scrolling.
  #   A rendering mode of the application.

  # Additional guideline [hybrid / proposed]: Preserve reading position when returning from an item.
  #   Within-session scroll/position restore is algorithmic.

  @guideline @algorithmic @proposed
  Scenario: A page change is announced
    Given a remediated pager showing N of M pages
    When the user moves to another page
    Then "page N of M" is announced politely


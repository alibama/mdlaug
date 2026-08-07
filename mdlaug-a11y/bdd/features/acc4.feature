# mDLAUG ACC4  |  Level AA  |  WCAG 1.3.1
# Interaction elements: List, List item, Breadcrumb
# Engine rule(s): collection-items
Feature: ACC4 — Difficulty accessing collection items
  As a screen-reader or low-vision user
  I want a collection exposed as a navigable list with clear hierarchy
  So that I can move through items and understand where I am

  @core @algorithmic @implemented
  Scenario: A results/collection container is exposed as a list
    Given a container of repeated item cards
    When the page is remediated
    Then the container gets role=list and each item role=listitem

  # Additional guideline [hybrid / implemented]: Present breadcrumb navigation showing collection hierarchy.
  #   Labelling an existing breadcrumb as a nav landmark is algorithmic (see EXE3); constructing a hierarchy where none exists is app-layer.

  # Additional guideline [manual / app-layer]: Provide collection statistics (number of items, formats, dates, subjects).
  #   Not reliably derivable from the DOM; comes from the catalogue/backend.

  # Additional guideline [manual / app-layer]: Allow direct navigation to popular or recently added items.
  #   Requires usage/recency data from the application.


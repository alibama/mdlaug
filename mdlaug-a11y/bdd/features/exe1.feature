# mDLAUG EXE1  |  Level A  |  WCAG 2.1.1
# Interaction elements: Clear button, Search input
# Engine rule(s): clear-search
Feature: EXE1 — Difficulty clearing a search box
  As a screen-reader or low-vision user
  I want an accessible, keyboard-operable clear control with feedback
  So that I can clear my query and know it worked

  @core @algorithmic @implemented
  Scenario: A clear affordance is named and operable
    Given a search box with an unlabelled × control
    When the page is remediated
    Then the clear control gets a name and is keyboard-operable

  @guideline @algorithmic @proposed
  Scenario: Clearing is confirmed
    Given a remediated clear control
    When the user activates it
    Then the search box is emptied and "search cleared" is announced

  # Additional guideline [manual / app-layer]: Offer recent searches after clearing the query.
  #   Requires search history from the application.

  # Additional guideline [hybrid / proposed]: Provide an undo option after accidental clearing.
  #   The extension can stash the last query and offer an accessible "undo"; within-page only.


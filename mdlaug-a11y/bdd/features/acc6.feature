# mDLAUG ACC6  |  Level AAA  |  WCAG 4.1.2
# Interaction elements: Autocomplete/Combobox, Listbox, Option
# Engine rule(s): autocomplete
Feature: ACC6 — Difficulty accessing a query suggestion
  As a screen-reader or low-vision user
  I want search autocomplete exposed as a proper combobox with announced options
  So that I can use suggestions with a screen reader

  @core @algorithmic @implemented
  Scenario: An autocomplete gets combobox semantics
    Given a search box with a custom suggestions panel
    When the page is remediated
    Then the input becomes role=combobox with aria-expanded and the list role=listbox / options role=option

  # Additional guideline [manual / app-layer]: Rank suggestions according to search history and collection popularity.
  #   Ranking is a backend/search concern.

  # Additional guideline [manual / app-layer]: Provide semantic query suggestions (broader, narrower, related terms).
  #   Requires a thesaurus/knowledge source in the application.

  # Additional guideline [hybrid / proposed]: Allow users to disable or customize auto-suggestions.
  #   The extension can add an accessible control to suppress the suggestions panel; honouring it across a session is stateful.


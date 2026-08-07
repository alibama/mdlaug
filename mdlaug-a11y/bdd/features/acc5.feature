# mDLAUG ACC5  |  Level A  |  WCAG 4.1.2, 4.1.3
# Interaction elements: Disclosure/Accordion, Button
# Engine rule(s): disclosure
Feature: ACC5 — Difficulty accessing expandable/collapsed content
  As a screen-reader or low-vision user
  I want disclosures to expose and announce their expanded/collapsed state
  So that I know whether content is open or closed

  @core @algorithmic @implemented
  Scenario: A custom disclosure gets state semantics
    Given a header that toggles a panel with no aria-expanded
    When the page is remediated
    Then the control gets role=button, aria-expanded, and aria-controls to its panel

  @guideline @algorithmic @proposed
  Scenario: A toggle announces its new state
    Given a remediated disclosure
    When the user activates it
    Then the new expanded/collapsed state is announced politely

  # Additional guideline [hybrid / proposed]: Remember users' expansion preferences during the browsing session.
  #   The extension can persist open/closed state in session storage and reapply it — algorithmic but stateful and opt-in.

  @guideline @algorithmic @proposed
  Scenario: Group controls are offered
    Given two or more sibling disclosures
    When the page is remediated
    Then accessible "Expand all" and "Collapse all" buttons are added and operate the group


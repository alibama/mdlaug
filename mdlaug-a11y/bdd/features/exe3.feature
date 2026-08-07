# mDLAUG EXE3  |  Level AA  |  WCAG 2.4.8
# Interaction elements: Breadcrumb, Back control
# Engine rule(s): back-affordance
Feature: EXE3 — Difficulty returning to a previous page
  As a screen-reader or low-vision user
  I want a clear, labelled way back and a breadcrumb trail
  So that I can retrace my steps

  @core @algorithmic @implemented
  Scenario: A breadcrumb becomes a labelled landmark
    Given a breadcrumb trail with no nav semantics
    When the page is remediated
    Then the breadcrumb gets role=navigation with an accessible label "Breadcrumb"


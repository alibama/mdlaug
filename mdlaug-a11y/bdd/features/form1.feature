# mDLAUG FORM1  |  Level A  |  WCAG 1.3.1, 3.3.2, 4.1.2
# Interaction elements: Input, Select, Textarea, Label
# Engine rule(s): form-fields
Feature: FORM1 — Accessible form fields (login / registration / account)
  As a screen-reader or low-vision user
  I want every form field to have a programmatic label and clear required/invalid state
  So that I can complete forms like sign-in and registration

  @core @algorithmic @implemented
  Scenario: Fields are labelled and required state reflected
    Given a form with an unlabelled field, a field with only a placeholder, and a required field
    When the page is remediated
    Then an adjacent label is associated, or the placeholder is used as a fallback name, and required fields get aria-required
    And a field with no label and no fallback is flagged for a human-written label

  # Additional guideline [hybrid / proposed]: Identify and describe form errors in text, associated with their field.
  #   Where an error message sits near an invalid field, the tool can wire aria-describedby + aria-invalid; the message wording is authored/app-supplied. (Candidate FORM2.)

  # Additional guideline [manual / manual]: Provide a human-written label when none exists anywhere.
  #   If no label, placeholder, or adjacent text exists, the accessible name must be authored — the tool only flags it.


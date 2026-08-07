# mDLAUG ACC1  |  Level A  |  WCAG 2.4.4, 3.2.2, 4.1.2
# Interaction elements: Link, Button
# Engine rule(s): file-links
Feature: ACC1 — Difficulty directly accessing files
  As a screen-reader or low-vision user
  I want linked files to announce their type, size, and new-window behaviour, and to be previewable inline
  So that I know what a link will do before I activate it, and can read it without losing my place

  @core @algorithmic @implemented
  Scenario: A file link lacking format information is repaired
    Given a link to "guide.pdf" with the text "Reading room guide"
    When the page is remediated
    Then the link's accessible name announces it is a "PDF file"
    And a link opening in a new window announces "opens in new window"
    And an inline-view control is offered

  @guideline @algorithmic @implemented
  Scenario: A supported file can be previewed inline
    Given a link to a PDF or DOCX file
    When the user activates "View inline"
    Then the file is rendered as accessible HTML in place, without a download

  # Additional guideline [hybrid / service]: Offer accessible alternative formats (HTML, EPUB, tagged PDF) whenever possible.
  #   Client-side conversion to accessible HTML/DOCX is algorithmic (the converter does it); EPUB and tagged-PDF generation, or serving them as canonical assets, is an app-layer/authoring task.

  # Additional guideline [algorithmic / implemented]: Preserve users' navigation context after viewing or downloading a file.
  #   Rendering inline (rather than navigating away) preserves context; focus is returned on close.


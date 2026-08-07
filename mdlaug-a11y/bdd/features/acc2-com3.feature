# mDLAUG ACC2/COM3  |  Level A  |  WCAG 1.1.1
# Interaction elements: Image, SVG, Canvas, CSS background
# Engine rule(s): images-alt, images-nontag
Feature: ACC2/COM3 — Difficulty accessing/comprehending images
  As a screen-reader or low-vision user
  I want every meaningful image to have a text alternative, at a level of detail I can choose
  So that I can understand what an image conveys

  @core @algorithmic @implemented
  Scenario: A content image without a usable alt is flagged, and non-<img> images are found
    Given an <img> with no alt, a filename-like alt, an empty alt on a large image, or an SVG/canvas/CSS-background image
    When the page is remediated
    Then the element is exposed as an image needing a text alternative (data-mdlaug-needs-alt)
    And the tool never invents the alt text

  # Additional guideline [hybrid / service]: Allow users to choose between brief and detailed image descriptions.
  #   A brief/detailed toggle is algorithmic UI; the two description texts must come from authored alt/longdesc or from a description service prompted at two levels.

  # Additional guideline [manual / manual]: Provide image descriptions at different levels (overview, detailed, scholarly context).
  #   Overview/detailed can be model-drafted, but scholarly/curatorial context is authored knowledge the tool must not fabricate.

  @guideline @hybrid @service
  Scenario: An AI description is offered and labelled
    Given an image needing a description and a configured description service
    When the user requests a description
    Then a description is inserted and clearly labelled as auto-generated / unverified


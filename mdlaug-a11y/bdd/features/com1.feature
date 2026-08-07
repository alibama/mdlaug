# mDLAUG COM1  |  Level A  |  WCAG 1.3.1, 2.4.1
# Interaction elements: Landmark, Heading, Skip link
# Engine rule(s): landmarks
Feature: COM1 — Difficulty understanding a digital library structure
  As a screen-reader or low-vision user
  I want clear landmarks, one main heading, and a skip link
  So that I can orient myself and jump to the content

  @core @algorithmic @implemented
  Scenario: Missing structure is added
    Given a page with no <main>, no skip link, or a broken heading start
    When the page is remediated
    Then a main landmark and a skip-to-content link are ensured and the heading order is sane

  # Additional guideline [manual / app-layer]: Provide a site overview or orientation page for first-time users.
  #   An authored page/feature.

  # Additional guideline [hybrid / proposed]: Offer an accessible sitemap.
  #   A sitemap can be generated from the site's navigation landmarks (algorithmic first pass); a canonical sitemap is app-layer.

  # Additional guideline [manual / manual]: Maintain consistent page layouts across collections.
  #   A design/authoring policy, not a per-page remediation.


# mDLAUG USE1  |  Level AAA  |  WCAG 4.1.2
# Interaction elements: All interactive elements
# Engine rule(s): icon-buttons
Feature: USE1 — Difficulty using screen readers and voice activated commands
  As a screen-reader or low-vision user
  I want the whole interface to work with my assistive technology and voice control
  So that I can use the library the way I use everything else

  @core @algorithmic @implemented
  Scenario: Controls carry names/roles that AT and voice control can target
    Given interactive controls lacking names/roles
    When the page is remediated
    Then controls gain the names and roles that screen readers and voice-control ("click <name>") rely on

  # Additional guideline [manual / manual]: Test compatibility across major assistive technologies (VoiceOver, TalkBack, Narrator, JAWS, NVDA).
  #   Cross-AT verification is a QA process, not a DOM remediation. The tool's automated pass is a first pass; manual screen-reader testing remains necessary.


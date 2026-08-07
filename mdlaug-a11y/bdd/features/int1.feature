# mDLAUG INT1  |  Level A  |  WCAG 2.1.2, 4.1.2
# Interaction elements: Dialog/Modal, Layered windows
# Engine rule(s): dialog-escape
Feature: INT1 — Difficulty interacting with multi-layered windows
  As a screen-reader or low-vision user
  I want stacked windows to trap focus correctly and expose the active layer
  So that I don't get lost between layers

  @core @algorithmic @implemented
  Scenario: A layered modal is made modal
    Given a modal stacked over page content
    When the page is remediated
    Then the top layer gets aria-modal and focus semantics so background content is inert to AT


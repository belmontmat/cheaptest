describe('Google Search', () => {
  beforeEach(() => {
    cy.visit('https://www.google.com');
    // Handle cookie consent if present
    cy.get('body').then($body => {
      if ($body.find('button:contains("Accept all")').length > 0) {
        cy.contains('button', 'Accept all').click();
      }
    });
  });

  it('should load Google homepage', () => {
    cy.title().should('include', 'Google');
    cy.get('textarea[name="q"]').should('be.visible');
  });

  it('should perform a search', () => {
    cy.get('textarea[name="q"]')
      .type('Cypress testing{enter}');

    cy.url().should('include', 'search');
    cy.get('#search, #rso').should('exist');
  });

  it('should display search suggestions', () => {
    cy.get('textarea[name="q"]').type('test automation');

    // Google suggestions appear in various containers
    cy.get('[role="listbox"], [role="presentation"] ul', { timeout: 5000 })
      .should('be.visible');
  });

  it('should navigate to Images', () => {
    cy.contains('a', 'Images').click();
    cy.url().should('include', 'imghp');
  });

  it('should have a search button', () => {
    // Google Search button - can be input or button element
    cy.get('input[value="Google Search"], button:contains("Google Search")')
      .first()
      .should('exist');
  });
});

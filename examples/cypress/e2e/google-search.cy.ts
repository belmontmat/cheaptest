describe('Google Search', () => {
  beforeEach(() => {
    cy.visit('https://www.google.com');
  });

  it('should load Google homepage', () => {
    cy.title().should('include', 'Google');
    cy.get('input[name="q"]').should('be.visible');
  });

  it('should perform a search', () => {
    cy.get('input[name="q"]')
      .type('Cypress testing{enter}');
    
    cy.url().should('include', 'search');
    cy.get('#search').should('be.visible');
  });

  it('should display search suggestions', () => {
    cy.get('input[name="q"]').type('test automation');
    
    cy.get('ul[role="listbox"]', { timeout: 5000 })
      .should('be.visible')
      .find('li')
      .should('have.length.greaterThan', 0);
  });

  it('should navigate to Images', () => {
    // Accept cookies if present
    cy.get('body').then($body => {
      if ($body.find('button:contains("Accept all")').length > 0) {
        cy.contains('button', 'Accept all').click();
      }
    });
    
    cy.contains('a', 'Images').click();
    cy.url().should('include', 'imghp');
  });

  it('should show "I\'m Feeling Lucky" button', () => {
    cy.get('input[name="btnI"]').should('be.visible');
  });
});
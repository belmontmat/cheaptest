describe('Google Navigation', () => {
  beforeEach(() => {
    cy.visit('https://www.google.com');
    // Handle cookie consent if present
    cy.get('body').then($body => {
      if ($body.find('button:contains("Accept all")').length > 0) {
        cy.contains('button', 'Accept all').click();
      }
    });
  });

  it('should have correct page title', () => {
    cy.title().should('eq', 'Google');
  });

  it('should have search input that is editable', () => {
    cy.get('textarea[name="q"]')
      .should('be.visible')
      .should('not.be.disabled');
  });

  it('should have Google logo', () => {
    // Logo can be img or svg depending on the page state
    cy.get('img[alt*="Google"], img[alt*="google"], [aria-label*="Google"]')
      .first()
      .should('be.visible');
  });

  it('should allow typing in search box', () => {
    const testText = 'test query';
    cy.get('textarea[name="q"]')
      .type(testText)
      .should('have.value', testText);
  });

  it('should clear search box', () => {
    cy.get('textarea[name="q"]')
      .type('test')
      .clear()
      .should('have.value', '');
  });
});

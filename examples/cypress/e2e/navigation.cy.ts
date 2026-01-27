describe('Google Navigation', () => {
  beforeEach(() => {
    cy.visit('https://www.google.com');
  });

  it('should have correct page title', () => {
    cy.title().should('eq', 'Google');
  });

  it('should have search input that is editable', () => {
    cy.get('input[name="q"]')
      .should('be.visible')
      .should('not.be.disabled');
  });

  it('should have Google logo', () => {
    cy.get('img[alt*="Google"]').should('be.visible');
  });

  it('should allow typing in search box', () => {
    const testText = 'test query';
    cy.get('input[name="q"]')
      .type(testText)
      .should('have.value', testText);
  });

  it('should clear search box', () => {
    cy.get('input[name="q"]')
      .type('test')
      .clear()
      .should('have.value', '');
  });
});
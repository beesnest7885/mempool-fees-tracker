// Prevent common errors from bubbling to console
const originalConsoleError = console.error;
console.error = function(msg, ...args) {
  // List of errors to suppress in the console
  const suppressErrors = [
    'ResizeObserver loop',
    'ResizeObserver loop completed with undelivered notifications',
    'Chrome not defined',
    'Chart is not defined',
    'can\'t access property "data"',
    'Cannot read properties of null',
    'Chart initialization failed',
    'Chart is not initialized'
  ];
  
  // Check if message is in the suppress list
  const shouldSuppress = typeof msg === 'string' && 
    suppressErrors.some(errMsg => msg.includes(errMsg));
  
  if (shouldSuppress) {
    // Log suppressed errors differently for debugging
    console.log('[Suppressed Error]', msg);
    return;
  }
  
  // Pass through all other errors
  originalConsoleError.apply(console, [msg, ...args]);
};
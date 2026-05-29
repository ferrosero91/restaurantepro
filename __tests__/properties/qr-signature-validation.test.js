/**
 * Property Test: QR Signature Validation
 * 
 * **Property 31: QR Signature Validation**
 * **Validates: Requirements 15.4, 15.5**
 * 
 * This property test validates QR code cryptographic signature integrity:
 * - Requirement 15.4: THE QR_Generator SHALL include a cryptographic signature in QR codes to prevent tampering
 * - Requirement 15.5: WHEN a QR code is scanned, THE System SHALL validate the signature before granting access
 */

const fc = require('fast-check');
const crypto = require('crypto');

// Import the service to test its cryptographic logic directly
const QRGeneratorService = require('../../services/QRGeneratorService');

describe('Property 31: QR Signature Validation', () => {
    let service;

    beforeEach(() => {
        service = new QRGeneratorService();
        // Use a fixed secret key for deterministic testing
        service.secretKey = 'test-secret-key-for-property-tests';
    });

    /**
     * Property: For any valid mesa_id and restaurante_id, a generated QR payload
     * always has a valid signature that passes validation.
     * **Validates: Requirements 15.4, 15.5**
     */
    test('generated QR code always has a valid signature that passes validation', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1000000000000, max: 9999999999999 }),
            (mesaId, restauranteId, timestamp) => {
                // Generate payload and signature (same logic as generateQRForMesa)
                const payload = {
                    mesa_id: mesaId,
                    restaurante_id: restauranteId,
                    timestamp: timestamp
                };

                const signature = service._generateSignature(payload);

                // Create QR data as the service would
                const qrData = JSON.stringify({ ...payload, signature });

                // Validate using the service's internal logic (without DB check)
                const parsed = JSON.parse(qrData);
                const { signature: extractedSig, ...extractedPayload } = parsed;
                const expectedSignature = service._generateSignature(extractedPayload);

                // The signature must always be valid
                const isValid = service._timingSafeEqual(extractedSig, expectedSignature);
                expect(isValid).toBe(true);
            }
        ), { numRuns: 200 });
    });

    /**
     * Property: For any modification to the QR payload (changing mesa_id or restaurante_id),
     * the signature validation always fails.
     * **Validates: Requirements 15.4, 15.5**
     */
    test('modified QR payload always fails signature validation', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1000000000000, max: 9999999999999 }),
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1, max: 100000 }),
            (mesaId, restauranteId, timestamp, tamperedMesaId, tamperedRestauranteId) => {
                // Skip cases where tampered values are the same as original
                fc.pre(tamperedMesaId !== mesaId || tamperedRestauranteId !== restauranteId);

                // Generate original payload and signature
                const originalPayload = {
                    mesa_id: mesaId,
                    restaurante_id: restauranteId,
                    timestamp: timestamp
                };

                const signature = service._generateSignature(originalPayload);

                // Tamper with the payload
                const tamperedPayload = {
                    mesa_id: tamperedMesaId,
                    restaurante_id: tamperedRestauranteId,
                    timestamp: timestamp
                };

                // Validate tampered payload against original signature
                const expectedSignature = service._generateSignature(tamperedPayload);
                const isValid = service._timingSafeEqual(signature, expectedSignature);

                // Tampered payload must always fail validation
                expect(isValid).toBe(false);
            }
        ), { numRuns: 200 });
    });

    /**
     * Property: For any random/forged signature, validation always fails against
     * a legitimately generated payload.
     * **Validates: Requirements 15.4, 15.5**
     */
    test('random or forged signature always fails validation', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1000000000000, max: 9999999999999 }),
            fc.array(fc.constantFrom('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f'), { minLength: 64, maxLength: 64 }).map(arr => arr.join('')),
            (mesaId, restauranteId, timestamp, forgedSignature) => {
                // Generate legitimate payload and its correct signature
                const payload = {
                    mesa_id: mesaId,
                    restaurante_id: restauranteId,
                    timestamp: timestamp
                };

                const legitimateSignature = service._generateSignature(payload);

                // Skip the astronomically unlikely case where random hex matches
                fc.pre(forgedSignature !== legitimateSignature);

                // Validate forged signature against the payload
                const isValid = service._timingSafeEqual(forgedSignature, legitimateSignature);

                // Forged signature must always fail
                expect(isValid).toBe(false);
            }
        ), { numRuns: 200 });
    });
});

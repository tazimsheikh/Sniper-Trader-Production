/**
 * Generates a determinisitc 32-bit integer magic number from a string signature.
 * Uses FNV-1a hash algorithm to ensure the same signature always maps to the same magic number.
 * 
 * To ensure no collisions between bots, we prefix the 8-digit hash with a bot-specific identifier:
 * MAGE: 1xxxxxxxx
 * SAGE: 2xxxxxxxx
 * SEER: 3xxxxxxxx
 */
export function generateMagicNumber(botType: 'MAGE' | 'SAGE' | 'SEER', signature: string): number {
    let hash = 2166136261;
    for (let i = 0; i < signature.length; i++) {
        hash ^= signature.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    // ensure it's a positive 31-bit integer up to 8 digits
    const num = (hash >>> 0) % 100000000;
    
    if (botType === 'MAGE') return 100000000 + num;
    if (botType === 'SAGE') return 200000000 + num;
    if (botType === 'SEER') return 300000000 + num;
    
    return num;
}

export function isMageMagic(magic: number | undefined | null): boolean {
    if (!magic) return false;
    return magic >= 100000000 && magic < 200000000;
}

export function isSageMagic(magic: number | undefined | null): boolean {
    if (!magic) return false;
    return magic >= 200000000 && magic < 300000000;
}

export function isSeerMagic(magic: number | undefined | null): boolean {
    if (!magic) return false;
    return magic >= 300000000 && magic < 400000000;
}

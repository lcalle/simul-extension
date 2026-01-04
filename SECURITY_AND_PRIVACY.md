
# SIMUL - Security & Privacy Trust Center

**Last Updated:** May 2024
**Owned by:** Mewmewmew, Inc.

This document outlines the security architecture, data handling practices, and privacy commitments for the SIMUL platform (simul.watch). It is designed to be transparent for users and auditors.

---

## 1. Data Architecture & Retention
SIMUL operates on a **Zero-Persistence Principle**. We do not want your data.

### 1.1 Volatile Memory (RAM Only)
*   **No Database:** SIMUL does not use a permanent database (SQL/NoSQL) to store chat logs or room activity.
*   **Room State:** Active rooms exist only in the server's volatile Random Access Memory (RAM).
*   **The "5-Minute" Rule:** Once the last participant leaves a room, a strictly enforced timer begins. If no one joins within 5 minutes, the room object—including all chat history, timestamps, and user lists—is **permanently garbage collected** from memory. It cannot be recovered by us or you.
*   **Routing Identifiers:** Room IDs and User IDs are treated as routing identifiers. They are stored in volatile memory for the duration of the session and are deleted on the same schedule as the room content.

### 1.2 No Account System
*   **Identity:** Users are identified solely by a transient Session ID. There are no passwords, emails, or phone numbers collected.
*   **Anonymity:** You choose your display name per session.

---

## 2. End-to-End Encryption (E2EE)
We implement client-side encryption to ensure that even though data passes through our servers, we cannot read it.

### 2.1 The Protocol
*   **Scope:** E2EE applies to **Chat Messages** and **Private Metadata**. Video playback commands (timestamp, play/pause status) are sent in plaintext to ensure frame-perfect synchronization, but contain no user-generated content.
*   **Algorithm:** AES-GCM (256-bit).
*   **Key Derivation:** We use **PBKDF2** (Password-Based Key Derivation Function 2) to generate a cryptographic key derived from your **Room ID**.
*   **Trust Model:** The server receives only an opaque "blob" of encrypted data (Base64). It broadcasts this blob to other users in the room. Decryption happens strictly in your browser (Client-Side).

### 2.2 Threat Model & Limitation of Liability
*   **Shared Secret:** Because the encryption key is derived from the Room ID, the **Room ID acts as the Shared Secret**. 
*   **Entropy Warning:** If you choose a weak Room ID (e.g., "Movie"), it may be guessable by others. If a third party guesses your Room ID, they can join the room and derive the key.
*   **Best Practice:** Treat your Room ID like a password. Share it only with trusted friends via a secure channel.

---

## 3. Copyright & Content Handling
SIMUL is a **Synchronization Engine**, not a streaming host.

*   **No Video Hosting:** SIMUL servers **never** touch, process, buffer, or relay video or audio files.
*   **BYO-Access:** The SIMUL Extension acts as a "Universal Remote." It clicks "Play" or "Pause" on the user's browser. The user must have their own legal access (subscription/login) to the underlying service (Netflix, Max, Disney+, etc.).
*   **DMCA Compliance:** Since we do not host content, we do not facilitate piracy. We synchronize the *timeline* of content you already legally access.

---

## 4. Threat Mitigation

### 4.1 Denial of Service (DoS)
*   **Rate Limiting:** The WebSocket server limits the number of messages a single client can send per second.
*   **Payload Caps:** Chat messages are capped at 1000 characters to prevent buffer overflow attacks.
*   **Room Caps:** Rooms are capped at 100 messages in memory (FIFO) to prevent memory exhaustion attacks.

### 4.2 Injection Attacks
*   **No HTML Rendering:** Chat messages are rendered as plain text. Any HTML or Script tags injected into chat will be displayed as raw text, neutralizing XSS (Cross-Site Scripting) attacks.

---

## 5. Misuse Policy
Mewmewmew, Inc. reserves the right to ban IP addresses that:
1.  Attempt to crash the signaling server.
2.  Use the signaling server for botnet command-and-control.
3.  Inject harmful payloads into the synchronization stream.

---

**Contact:**
For security reports or white-hat disclosures, please contact the maintainers at Mewmewmew, Inc.


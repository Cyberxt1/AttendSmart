/**
 * Adeleke University QR Attendance System
 * Firebase + Firestore runtime layer
 */

const APP_CONFIG = {
    SCHOOL_NAME: "Adeleke University",
    SYSTEM_NAME: "AttendQR",
    VERSION: "2.0.0",
    SUPERADMIN_EMAIL: "oluwadimimu.king@gmail.com",
    QR_PAYLOAD_VERSION: 1,
    REFRESH_INTERVAL: 30000,
    LIVE_FEED_INTERVAL: 10000,
    QR_REFRESH_INTERVAL: 30000,
    SESSION_TIMEOUT: 900000,
    DARK_MODE_KEY: "attendance_dark_mode",
    USER_CACHE_KEY: "attendance_current_user",
    RECENT_SCANS_KEY: "attendance_recent_scans",
    FIREBASE_CONFIG_PATH: "firebase-config.js",
    FIREBASE_SDK_VERSION: "10.12.5"
};

const DEFAULT_SYSTEM_SETTINGS = {
    qrRefreshIntervalSeconds: 30,
    lateThresholdMinutes: 15,
    sessionAutoExpiry: true,
    notifications: {
        attendanceEmails: true,
        sessionExpiryAlerts: true,
        dailySummary: false
    }
};

const COLLECTIONS = {
    USERS: "users",
    MATRIC_INDEX: "matricIndex",
    COURSES: "courses",
    COURSE_REGISTRATIONS: "courseRegistrations",
    SESSIONS: "sessions",
    ATTENDANCE: "attendance",
    SETTINGS: "settings"
};

const AppState = {
    readyPromise: null,
    firebaseConfigured: false,
    firebaseAvailable: false,
    currentSystemSettings: { ...DEFAULT_SYSTEM_SETTINGS }
};

const Utils = {
    getAppScriptUrl() {
        const currentScript = document.currentScript;
        if (currentScript?.src && currentScript.src.includes("/js/app.js")) {
            return currentScript.src;
        }

        const appScript = document.querySelector('script[src$="/js/app.js"], script[src$="js/app.js"]');
        return appScript?.src || "";
    },

    resolveAppAssetPath(assetPath = "") {
        const normalizedAssetPath = String(assetPath || "").replace(/^\.?\//, "");
        const appScriptUrl = this.getAppScriptUrl();

        if (appScriptUrl) {
            return new URL(normalizedAssetPath, appScriptUrl).toString();
        }

        return normalizedAssetPath;
    },

    resolveFrontendPath(pagePath = "") {
        const normalizedPagePath = String(pagePath || "").replace(/^\.?\//, "");
        const appScriptUrl = this.getAppScriptUrl();

        if (appScriptUrl) {
            return new URL(`../${normalizedPagePath}`, appScriptUrl).toString();
        }

        return normalizedPagePath;
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    async loadScript(src) {
        const existing = document.querySelector(`script[data-dynamic-src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === "true") return;
            await new Promise((resolve, reject) => {
                existing.addEventListener("load", resolve, { once: true });
                existing.addEventListener("error", reject, { once: true });
            });
            return;
        }

        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.async = false;
            script.dataset.dynamicSrc = src;
            script.onload = () => {
                script.dataset.loaded = "true";
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    slugify(value = "") {
        return value
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");
    },

    randomString(length = 24) {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        let output = "";

        for (let i = 0; i < length; i += 1) {
            output += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        return output;
    },

    generateManualCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    },

    normalizeMatricNo(value = "") {
        return value.toString().trim().replace(/\s+/g, "");
    },

    validateMatricNo(value = "") {
        const matricNo = this.normalizeMatricNo(value);
        const match = matricNo.match(/^(\d{2})\/(\d{4})$/);

        if (!match) {
            return {
                valid: false,
                message: "Matric number must be in the format 21/0021."
            };
        }

        const yearPrefix = Number(match[1]);
        const currentFullYear = new Date().getFullYear();
        const currentShortYear = currentFullYear % 100;
        const fullYear = yearPrefix <= currentShortYear ? 2000 + yearPrefix : 1900 + yearPrefix;
        const ageInYears = currentFullYear - fullYear;

        if (ageInYears > 5) {
            const oldestAcceptedPrefix = String((currentFullYear - 5) % 100).padStart(2, "0");
            return {
                valid: false,
                message: `Matric numbers older than 5 years are not allowed. As of ${currentFullYear}, the oldest accepted year prefix is ${oldestAcceptedPrefix}.`
            };
        }

        return {
            valid: true,
            matricNo,
            yearPrefix,
            fullYear
        };
    },

    normalizeDepartment(value = "") {
        return value
            .split("-")
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    },

    toDate(value) {
        if (!value) return null;
        if (value instanceof Date) return value;
        if (value?.toDate) return value.toDate();
        return new Date(value);
    },

    toIsoString(value) {
        const date = this.toDate(value);
        return date ? date.toISOString() : null;
    },

    isSameDay(a, b = new Date()) {
        const dateA = this.toDate(a);
        const dateB = this.toDate(b);
        if (!dateA || !dateB) return false;
        return dateA.toDateString() === dateB.toDateString();
    },

    copy(value) {
        return JSON.parse(JSON.stringify(value));
    },

    buildQrPayload(session) {
        return JSON.stringify({
            version: APP_CONFIG.QR_PAYLOAD_VERSION,
            type: "attendance-session",
            sessionId: session.id,
            courseCode: session.courseCode,
            qrToken: session.qrToken,
            issuedAt: session.qrIssuedAt || session.startTime || new Date().toISOString(),
            expiresAt: session.qrExpiresAt || null
        });
    },

    parseQrPayload(rawValue = "") {
        const value = String(rawValue || "").trim();
        if (!value) {
            return { qrToken: "" };
        }

        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === "object" && parsed.qrToken) {
                return {
                    qrToken: String(parsed.qrToken).trim(),
                    sessionId: parsed.sessionId ? String(parsed.sessionId).trim() : "",
                    expiresAt: parsed.expiresAt ? String(parsed.expiresAt).trim() : ""
                };
            }
        } catch (error) {
            // Not a JSON payload, continue with legacy token parsing.
        }

        return { qrToken: value };
    },

    isSuperAdminEmail(email = "") {
        return String(email || "").trim().toLowerCase() === APP_CONFIG.SUPERADMIN_EMAIL.toLowerCase();
    },

    getAccountStatus(user = {}) {
        if (!user) return "inactive";
        if (user.deletedAt) return "archived";
        if (String(user.accountStatus || "").trim().toLowerCase() === "disabled" || user.disabled === true) {
            return "disabled";
        }
        return "active";
    },

    isAccountActive(user = {}) {
        return this.getAccountStatus(user) === "active";
    }
};

const App = {
    async ready() {
        if (!AppState.readyPromise) {
            AppState.readyPromise = Backend.initialize();
        }

        await AppState.readyPromise;
        return AppState.firebaseConfigured;
    },

    isConfigured() {
        return AppState.firebaseConfigured;
    },

    assertConfigured() {
        if (!AppState.firebaseConfigured) {
            throw new Error("Firebase is not configured yet. Add your keys to frontend/js/firebase-config.js.");
        }
    },

    getSystemSettings() {
        return Utils.copy(AppState.currentSystemSettings);
    }
};

const Backend = {
    async initialize() {
        await this.loadRuntimeConfig();
        await this.loadFirebaseSdk();

        if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey || !window.FIREBASE_CONFIG.projectId) {
            console.warn("Firebase config missing. Update frontend/js/firebase-config.js before using the live backend.");
            return false;
        }

        if (!window.firebase?.apps?.length) {
            window.firebase.initializeApp(window.FIREBASE_CONFIG);
        }

        this.auth = window.firebase.auth();
        this.db = window.firebase.firestore();

        try {
            await this.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
        } catch (error) {
            console.warn("Auth persistence could not be set:", error);
        }

        AppState.firebaseAvailable = true;
        AppState.firebaseConfigured = true;

        await new Promise(resolve => {
            const unsubscribe = this.auth.onAuthStateChanged(async user => {
                unsubscribe();

                if (user) {
                    await Auth.hydrateUser(user);
                } else {
                    Auth.clearSessionCache();
                }

                resolve();
            });
        });

        if (this.auth.currentUser) {
            try {
                const settingsSnapshot = await this.db.collection(COLLECTIONS.SETTINGS).doc("system").get();
                if (settingsSnapshot.exists) {
                    AppState.currentSystemSettings = {
                        ...DEFAULT_SYSTEM_SETTINGS,
                        ...settingsSnapshot.data()
                    };
                }
            } catch (error) {
                console.warn("System settings could not be loaded:", error);
            }
        }

        return true;
    },

    async loadRuntimeConfig() {
        try {
            await Utils.loadScript(Utils.resolveAppAssetPath(APP_CONFIG.FIREBASE_CONFIG_PATH));
        } catch (error) {
            console.warn("firebase-config.js could not be loaded:", error);
        }
    },

    async loadFirebaseSdk() {
        if (window.firebase?.apps) {
            return;
        }

        const base = `https://www.gstatic.com/firebasejs/${APP_CONFIG.FIREBASE_SDK_VERSION}`;
        await Utils.loadScript(`${base}/firebase-app-compat.js`);
        await Utils.loadScript(`${base}/firebase-auth-compat.js`);
        await Utils.loadScript(`${base}/firebase-firestore-compat.js`);
    },

    getDb() {
        App.assertConfigured();
        return this.db;
    },

    getAuth() {
        App.assertConfigured();
        return this.auth;
    }
};

const DataStore = {
    saveUser(user) {
        localStorage.setItem(APP_CONFIG.USER_CACHE_KEY, JSON.stringify(user));
    },

    getUser() {
        const raw = localStorage.getItem(APP_CONFIG.USER_CACHE_KEY);

        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch (error) {
            localStorage.removeItem(APP_CONFIG.USER_CACHE_KEY);
            return null;
        }
    },

    clearUser() {
        localStorage.removeItem(APP_CONFIG.USER_CACHE_KEY);
    },

    saveRecentScans(scans) {
        localStorage.setItem(APP_CONFIG.RECENT_SCANS_KEY, JSON.stringify(scans));
    },

    getRecentScans() {
        const raw = localStorage.getItem(APP_CONFIG.RECENT_SCANS_KEY);

        if (!raw) return [];

        try {
            return JSON.parse(raw);
        } catch (error) {
            localStorage.removeItem(APP_CONFIG.RECENT_SCANS_KEY);
            return [];
        }
    }
};

const Auth = {
    currentUser: DataStore.getUser(),
    firebaseUser: null,
    sessionToken: null,

    async init() {
        await App.ready();
        return this.isAuthenticated();
    },

    async hydrateUser(firebaseUser) {
        this.firebaseUser = firebaseUser;
        this.sessionToken = firebaseUser.uid;

        const userRef = Backend.getDb().collection(COLLECTIONS.USERS).doc(firebaseUser.uid);
        let profileSnapshot = await userRef.get();

        if (!profileSnapshot.exists && Utils.isSuperAdminEmail(firebaseUser.email)) {
            await this.ensureSuperAdminProfile(firebaseUser);
            profileSnapshot = await userRef.get();
        }
        const profile = profileSnapshot.exists
            ? {
                id: profileSnapshot.id,
                uid: profileSnapshot.id,
                ...profileSnapshot.data()
            }
            : null;

        if (!profile) {
            const fallbackUser = {
                id: firebaseUser.uid,
                uid: firebaseUser.uid,
                name: firebaseUser.displayName || firebaseUser.email,
                fullName: firebaseUser.displayName || firebaseUser.email,
                email: firebaseUser.email,
                role: Utils.isSuperAdminEmail(firebaseUser.email) ? "admin" : "student",
                isSuperAdmin: Utils.isSuperAdminEmail(firebaseUser.email),
                department: "",
                avatar: "👤"
            };

            this.currentUser = fallbackUser;
        } else {
            this.currentUser = profile;
        }

        DataStore.saveUser(this.currentUser);
        return this.currentUser;
    },

    async ensureSuperAdminProfile(firebaseUser) {
        if (!Utils.isSuperAdminEmail(firebaseUser?.email)) {
            return null;
        }

        const userRef = Backend.getDb().collection(COLLECTIONS.USERS).doc(firebaseUser.uid);
        await userRef.set({
            uid: firebaseUser.uid,
            fullName: firebaseUser.displayName || "Super Admin",
            name: firebaseUser.displayName || "Super Admin",
            email: firebaseUser.email,
            role: "admin",
            accountStatus: "active",
            isSuperAdmin: true,
            department: "Administration",
            avatar: "A",
            createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return userRef.get();
    },

    async refreshCurrentUser() {
        await App.ready();

        const firebaseUser = Backend.getAuth().currentUser;
        if (!firebaseUser) {
            this.clearSessionCache();
            return null;
        }

        return this.hydrateUser(firebaseUser);
    },

    async login(email, password, role = "") {
        await App.ready();
        App.assertConfigured();
        const auth = Backend.getAuth();

        try {
            const credential = await auth.signInWithEmailAndPassword(email, password);
            const user = await this.hydrateUser(credential.user);

            if (!Utils.isAccountActive(user)) {
                await auth.signOut();
                this.clearSessionCache();
                throw new Error("This account is not active. Please contact the administrator.");
            }

            if (role && user.role !== role) {
                await auth.signOut();
                this.clearSessionCache();
                throw new Error(`This account is registered as ${user.role}, not ${role}.`);
            }

            return {
                success: true,
                user,
                message: `Welcome to ${APP_CONFIG.SCHOOL_NAME} Attendance System`
            };
        } catch (error) {
            this.clearSessionCache();

            return {
                success: false,
                message: this.getFriendlyAuthError(error)
            };
        }
    },

    async register(registrationData, options = {}) {
        await App.ready();
        App.assertConfigured();

        const db = Backend.getDb();
        const auth = Backend.getAuth();
        const email = registrationData.email.trim().toLowerCase();
        const role = options.mode === "privileged"
            ? String(registrationData.role || "lecturer").trim().toLowerCase()
            : "student";
        const departmentKey = String(registrationData.department || "").trim();
        const department = Utils.normalizeDepartment(departmentKey);
        const matricValidation = role === "student"
            ? Utils.validateMatricNo(registrationData.matricNo)
            : { valid: true };
        const matricNo = role === "student"
            ? Utils.normalizeMatricNo(registrationData.matricNo)
            : "";

        if (!["student", "lecturer", "admin"].includes(role)) {
            return {
                success: false,
                message: "That account type is not supported."
            };
        }

        if (!matricValidation.valid) {
            return {
                success: false,
                message: matricValidation.message
            };
        }

        if (role === "admin" && !Utils.isSuperAdminEmail(email)) {
            return {
                success: false,
                message: "Administrator self-registration is reserved for the superadmin email."
            };
        }

        const fullName = String(registrationData.fullName || "").trim()
            || (role === "student" ? email.split("@")[0] : "");

        try {
            const credential = await auth.createUserWithEmailAndPassword(email, registrationData.password);
            const userRef = db.collection(COLLECTIONS.USERS).doc(credential.user.uid);
            const matricRef = role === "student"
                ? db.collection(COLLECTIONS.MATRIC_INDEX).doc(matricNo.replace(/\//g, "-"))
                : null;

            await db.runTransaction(async transaction => {
                if (role === "student") {
                    const matricSnapshot = await transaction.get(matricRef);

                    if (matricSnapshot.exists) {
                        throw new Error("A student with this matric number already exists.");
                    }

                    transaction.set(matricRef, {
                        matricNo,
                        uid: credential.user.uid,
                        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
                    });
                }

                transaction.set(userRef, {
                    uid: credential.user.uid,
                    fullName,
                    name: fullName,
                    email,
                    matricNo: role === "student" ? matricNo : "",
                    department,
                    departmentKey,
                    role,
                    avatar: role === "student" ? "🎓" : role === "admin" ? "🛡️" : "👩‍🏫",
                    accountStatus: "active",
                    isSuperAdmin: role === "admin" && Utils.isSuperAdminEmail(email),
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                    profileCompleted: role === "student" ? false : true,
                    preferences: {
                        notifications: { ...DEFAULT_SYSTEM_SETTINGS.notifications }
                    }
                });
            });

            await auth.signOut();
            this.clearSessionCache();

            return {
                success: true,
                message: `${role === "student" ? "Student" : role === "admin" ? "Administrator" : "Lecturer"} registration successful! Please login.`,
                studentId: role === "student" ? matricNo : credential.user.uid
            };
        } catch (error) {
            if (auth.currentUser) {
                try {
                    await auth.currentUser.delete();
                } catch (cleanupError) {
                    console.warn("New user cleanup failed:", cleanupError);
                }
            }

            try {
                await auth.signOut();
            } catch (signOutError) {
                console.warn("Registration sign-out failed:", signOutError);
            }

            this.clearSessionCache();

            return {
                success: false,
                message: error?.message === "A student with this matric number already exists."
                    ? error.message
                    : this.getFriendlyAuthError(error)
            };
        }
    },

    async logout() {
        try {
            if (App.isConfigured()) {
                await Backend.getAuth().signOut();
            }
        } catch (error) {
            console.warn("Logout error:", error);
        } finally {
            this.clearSessionCache();
            window.location.href = Utils.resolveFrontendPath("index.html");
        }
    },

    clearSessionCache() {
        this.currentUser = null;
        this.firebaseUser = null;
        this.sessionToken = null;
        DataStore.clearUser();
    },

    isAuthenticated() {
        return !!this.currentUser && Utils.isAccountActive(this.currentUser);
    },

    hasRole(roles) {
        if (!this.currentUser) return false;
        if (Array.isArray(roles)) {
            return roles.includes(this.currentUser.role);
        }
        return this.currentUser.role === roles;
    },

    getCurrentUser() {
        return this.currentUser;
    },

    needsStudentProfileCompletion(user = this.currentUser) {
        return !!(
            user
            && user.role === "student"
            && (
                user.profileCompleted !== true
                || !String(user.fullName || user.name || "").trim()
                || !String(user.matricNo || "").trim()
                || !String(user.department || "").trim()
                || !String(user.level || "").trim()
            )
        );
    },

    async completeStudentProfile(profileData) {
        await App.ready();
        App.assertConfigured();

        const currentUser = Backend.getAuth().currentUser;
        const currentProfile = this.getCurrentUser();

        if (!currentUser || !currentProfile || currentProfile.role !== "student") {
            throw new Error("Only student accounts can complete this profile.");
        }

        const fullName = String(profileData.fullName || "").trim();
        const departmentKey = String(profileData.department || "").trim();
        const department = Utils.normalizeDepartment(departmentKey);
        const level = String(profileData.level || "").trim();
        const matricValidation = Utils.validateMatricNo(profileData.matricNo);
        const matricNo = Utils.normalizeMatricNo(profileData.matricNo);

        if (!fullName) {
            throw new Error("Enter your full name.");
        }

        if (!departmentKey) {
            throw new Error("Select your department.");
        }

        if (!level) {
            throw new Error("Select your level.");
        }

        if (!matricValidation.valid) {
            throw new Error(matricValidation.message);
        }

        const db = Backend.getDb();
        const userRef = db.collection(COLLECTIONS.USERS).doc(currentUser.uid);
        const matricRef = db.collection(COLLECTIONS.MATRIC_INDEX).doc(matricNo.replace(/\//g, "-"));
        const previousMatric = String(currentProfile.matricNo || "").trim();
        const previousMatricRef = previousMatric
            ? db.collection(COLLECTIONS.MATRIC_INDEX).doc(previousMatric.replace(/\//g, "-"))
            : null;

        await db.runTransaction(async transaction => {
            const userSnapshot = await transaction.get(userRef);
            const matricSnapshot = await transaction.get(matricRef);
            const previousMatricSnapshot = previousMatricRef
                ? await transaction.get(previousMatricRef)
                : null;

            if (!userSnapshot.exists) {
                throw new Error("Your student profile could not be found.");
            }

            if (matricSnapshot.exists && matricSnapshot.data()?.uid !== currentUser.uid) {
                throw new Error("A student with this matric number already exists.");
            }

            if (previousMatricRef && previousMatric !== matricNo && previousMatricSnapshot?.exists) {
                transaction.delete(previousMatricRef);
            }

            transaction.set(matricRef, {
                matricNo,
                uid: currentUser.uid,
                createdAt: matricSnapshot.exists
                    ? (matricSnapshot.data()?.createdAt || window.firebase.firestore.FieldValue.serverTimestamp())
                    : window.firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            transaction.update(userRef, {
                fullName,
                name: fullName,
                matricNo,
                department,
                departmentKey,
                level,
                profileCompleted: true,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await currentUser.updateProfile({ displayName: fullName });
        await this.refreshCurrentUser();
        return this.currentUser;
    },

    async updateProfile(profileUpdates) {
        await App.ready();
        App.assertConfigured();

        const currentUser = Backend.getAuth().currentUser;
        if (!currentUser) {
            throw new Error("You need to sign in again before updating your profile.");
        }

        const updates = {};
        if (profileUpdates.fullName) {
            updates.fullName = profileUpdates.fullName.trim();
            updates.name = profileUpdates.fullName.trim();
        }
        if (profileUpdates.department) {
            updates.department = Utils.normalizeDepartment(profileUpdates.department);
            updates.departmentKey = profileUpdates.department;
        }
        if (profileUpdates.level) {
            updates.level = String(profileUpdates.level).trim();
        }
        if (profileUpdates.email) {
            updates.email = profileUpdates.email.trim().toLowerCase();
        }

        updates.updatedAt = window.firebase.firestore.FieldValue.serverTimestamp();

        if (profileUpdates.fullName) {
            await currentUser.updateProfile({ displayName: profileUpdates.fullName.trim() });
        }

        if (profileUpdates.email && profileUpdates.email.trim().toLowerCase() !== currentUser.email) {
            await currentUser.updateEmail(profileUpdates.email.trim().toLowerCase());
        }

        await Backend.getDb().collection(COLLECTIONS.USERS).doc(currentUser.uid).update(updates);
        await this.refreshCurrentUser();
        return this.currentUser;
    },

    async changePassword(currentPassword, newPassword) {
        await App.ready();
        App.assertConfigured();

        const currentUser = Backend.getAuth().currentUser;
        if (!currentUser?.email) {
            throw new Error("You need to sign in again before changing your password.");
        }

        const credential = window.firebase.auth.EmailAuthProvider.credential(
            currentUser.email,
            currentPassword
        );

        await currentUser.reauthenticateWithCredential(credential);
        await currentUser.updatePassword(newPassword);
    },

    getFriendlyAuthError(error) {
        const code = error?.code || "";
        const messages = {
            "auth/user-not-found": "No account was found with that email address.",
            "auth/wrong-password": "The password you entered is incorrect.",
            "auth/invalid-credential": "The email or password you entered is incorrect.",
            "auth/email-already-in-use": "That email address is already registered.",
            "auth/weak-password": "Choose a stronger password with at least 6 characters.",
            "auth/invalid-email": "Enter a valid email address.",
            "auth/requires-recent-login": "Please sign out and sign in again before making this change."
        };

        return messages[code] || error?.message || "Authentication failed. Please try again.";
    }
};

const UI = {
    toast(message, type = "info", duration = 3000) {
        const toastContainer = document.getElementById("toast-container") || this.createToastContainer();
        const toast = document.createElement("div");

        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${this.getToastIcon(type)}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;

        toastContainer.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add("show");
        });

        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    createToastContainer() {
        const container = document.createElement("div");
        container.id = "toast-container";
        container.className = "toast-container";
        document.body.appendChild(container);
        return container;
    },

    getToastIcon(type) {
        const icons = {
            success: "✅",
            error: "❌",
            warning: "⚠️",
            info: "ℹ️"
        };
        return icons[type] || icons.info;
    },

    getErrorMessage(error, fallback = "Something went wrong.") {
        return error?.message || fallback;
    },

    toggleModal(modalId, show = true) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        if (show) {
            modal.classList.add("active");
            document.body.style.overflow = "hidden";
        } else {
            modal.classList.remove("active");
            document.body.style.overflow = "";
        }
    },

    setButtonLoading(button, loading = true, loadingText = "Loading...") {
        if (!button) return;

        if (loading) {
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = `<span class="spinner"></span> ${loadingText}`;
            button.disabled = true;
        } else {
            button.innerHTML = button.dataset.originalText || button.innerHTML;
            button.disabled = false;
        }
    },

    formatTime(time) {
        const date = Utils.toDate(time);
        if (!date) return "--";

        return date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        });
    },

    formatDate(date) {
        const value = Utils.toDate(date);
        if (!value) return "--";

        return value.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    },

    formatDateTime(datetime) {
        const value = Utils.toDate(datetime);
        if (!value) return "--";
        return `${this.formatDate(value)} ${this.formatTime(value)}`;
    },

    timeAgo(time) {
        const date = Utils.toDate(time);
        if (!date) return "--";

        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);

        if (seconds < 10) return "Just now";
        if (seconds < 60) return `${seconds}s ago`;

        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;

        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;

        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;

        return this.formatDate(date);
    },

    formatNumber(num) {
        return Number(num || 0).toLocaleString();
    },

    setPageTitle(pageTitle) {
        document.title = `${APP_CONFIG.SCHOOL_NAME} | ${pageTitle}`;
    },

    setSchoolBranding() {
        document.querySelectorAll(".school-name, .school-title").forEach(el => {
            el.textContent = APP_CONFIG.SCHOOL_NAME;
        });

        document.querySelectorAll(".system-title").forEach(el => {
            el.textContent = `${APP_CONFIG.SYSTEM_NAME} System`;
        });

        document.querySelectorAll(".school-subtitle").forEach(el => {
            el.textContent = "QR Attendance Management System";
        });
    }
};

const DarkMode = {
    init() {
        const isDark = localStorage.getItem(APP_CONFIG.DARK_MODE_KEY) === "true";
        if (isDark) {
            document.body.classList.add("dark-mode");
        }
        this.updateToggleIcon();
    },

    toggle() {
        document.body.classList.toggle("dark-mode");
        const isDark = document.body.classList.contains("dark-mode");
        localStorage.setItem(APP_CONFIG.DARK_MODE_KEY, isDark);
        this.updateToggleIcon();
    },

    updateToggleIcon() {
        const toggle = document.getElementById("dark-mode-toggle");
        if (!toggle) return;

        const isDark = document.body.classList.contains("dark-mode");
        toggle.innerHTML = isDark ? "☀️" : "🌙";
        toggle.title = isDark ? "Switch to Light Mode" : "Switch to Dark Mode";
    },

    isActive() {
        return document.body.classList.contains("dark-mode");
    }
};

const CountdownTimer = {
    timers: {},

    start(sessionId, endTime, onExpire = null) {
        this.stop(sessionId);

        const updateTimer = () => {
            const now = new Date();
            const end = Utils.toDate(endTime);
            const diff = end - now;

            if (diff <= 0) {
                this.stop(sessionId);
                const element = document.getElementById(`timer-${sessionId}`);
                if (element) {
                    element.innerHTML = '<span class="timer-expired">Session Expired</span>';
                }
                if (onExpire) onExpire(sessionId);
                return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            const element = document.getElementById(`timer-${sessionId}`);

            if (element) {
                element.innerHTML = `
                    <span class="timer-label">Session Ends In:</span>
                    <span class="timer-value">${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}</span>
                `;
            }
        };

        updateTimer();
        this.timers[sessionId] = setInterval(updateTimer, 1000);
    },

    stop(sessionId) {
        if (this.timers[sessionId]) {
            clearInterval(this.timers[sessionId]);
            delete this.timers[sessionId];
        }
    },

    stopAll() {
        Object.keys(this.timers).forEach(sessionId => this.stop(sessionId));
    }
};

const ExportModule = {
    toCSV(data, filename = "export") {
        if (!data?.length) {
            UI.toast("No data to export", "warning");
            return;
        }

        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(","),
            ...data.map(row => headers.map(header => {
                const value = row[header];
                if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value ?? "";
            }).join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        const date = new Date().toISOString().split("T")[0];

        link.href = URL.createObjectURL(blob);
        link.download = `${filename}-${date}.csv`;
        link.click();

        UI.toast("CSV exported successfully", "success");
    },

    toPDF(title = "Attendance Report") {
        const printWindow = window.open("", "_blank");
        const date = new Date().toISOString().split("T")[0];

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${title} - ${date}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .school-name { font-size: 24px; font-weight: bold; color: #1e40af; }
                    .report-title { font-size: 18px; margin: 10px 0; }
                    .report-date { color: #666; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                    th { background-color: #1e40af; color: white; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="school-name">${APP_CONFIG.SCHOOL_NAME}</div>
                    <div class="report-title">${title}</div>
                    <div class="report-date">Generated on: ${new Date().toLocaleString()}</div>
                </div>
                ${document.querySelector(".table-responsive")?.innerHTML || "<p>No data available</p>"}
                <div class="footer">
                    <p>Generated by ${APP_CONFIG.SYSTEM_NAME} System</p>
                    <p>&copy; ${new Date().getFullYear()} ${APP_CONFIG.SCHOOL_NAME}</p>
                </div>
            </body>
            </html>
        `);

        printWindow.document.close();
        printWindow.focus();

        setTimeout(() => {
            printWindow.print();
        }, 500);

        UI.toast("PDF export prepared", "success");
    }
};

const SearchFilter = {
    init(searchInputId, containerId, itemSelector, searchFields = ["textContent"]) {
        const searchInput = document.getElementById(searchInputId);
        const container = document.getElementById(containerId);

        if (!searchInput || !container) return;

        searchInput.addEventListener("input", e => {
            const query = e.target.value.toLowerCase().trim();
            const items = container.querySelectorAll(itemSelector);
            let hasResults = false;

            items.forEach(item => {
                let match = false;

                searchFields.forEach(field => {
                    if (field === "textContent" && item.textContent.toLowerCase().includes(query)) {
                        match = true;
                    } else {
                        const el = item.querySelector(`[data-${field}]`);
                        if (el && el.textContent.toLowerCase().includes(query)) {
                            match = true;
                        }
                    }
                });

                if (match || query === "") {
                    item.style.display = "";
                    hasResults = true;
                } else {
                    item.style.display = "none";
                }
            });

            let noResultsEl = container.querySelector(".no-search-results");
            if (!hasResults && query !== "") {
                if (!noResultsEl) {
                    noResultsEl = document.createElement("div");
                    noResultsEl.className = "no-search-results";
                    noResultsEl.innerHTML = "<p>No matching results found</p>";
                    container.appendChild(noResultsEl);
                }
                noResultsEl.style.display = "block";
            } else if (noResultsEl) {
                noResultsEl.style.display = "none";
            }
        });
    }
};

const Page = {
    getRoute(page = "index.html") {
        return Utils.resolveFrontendPath(page);
    },

    getDefaultRoute(user = Auth.getCurrentUser()) {
        if (!user) return this.getRoute("index.html");
        if (user.role === "student") return this.getRoute("scanner.html");
        if (user.role === "admin") return this.getRoute("admin-dashboard.html");
        if (user.role === "lecturer") return this.getRoute("lecturer-dashboard.html");
        return this.getRoute("index.html");
    },

    async requireAuth(roles = null) {
        await App.ready();

        if (!Auth.isAuthenticated()) {
            window.location.href = this.getRoute("index.html");
            return null;
        }

        if (roles && !Auth.hasRole(roles)) {
            window.location.href = this.getDefaultRoute();
            return null;
        }

        return Auth.getCurrentUser();
    },

    async redirectAuthenticatedUser() {
        await App.ready();

        if (Auth.isAuthenticated()) {
            window.location.href = this.getDefaultRoute();
        }
    },

    bindCommonUi() {
        DarkMode.init();
        UI.setSchoolBranding();

        const pageName = document.body.dataset.page || "Dashboard";
        UI.setPageTitle(pageName);

        const darkModeToggle = document.getElementById("dark-mode-toggle");
        if (darkModeToggle && !darkModeToggle.dataset.bound) {
            darkModeToggle.dataset.bound = "true";
            darkModeToggle.addEventListener("click", () => DarkMode.toggle());
        }
    },

    fillUserCard(user = Auth.getCurrentUser()) {
        if (!user) return;

        const dashboardRoute = this.getDefaultRoute(user);
        document.querySelectorAll('a[href="dashboard.html"]').forEach(link => {
            link.href = dashboardRoute;
        });

        const shouldHideForAdmin = user.role === "admin";
        ["sessions.html", "courses.html", "students.html"].forEach(path => {
            document.querySelectorAll(`a[href="${path}"]`).forEach(link => {
                link.style.display = shouldHideForAdmin ? "none" : "";
            });
        });

        const avatar = user.avatar || (user.role === "student" ? "🎓" : "👤");
        const roleLabel = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "User";

        const userName = document.getElementById("user-name");
        const userRole = document.getElementById("user-role");
        const userAvatar = document.getElementById("user-avatar");

        if (userName) userName.textContent = user.name || user.fullName || user.email;
        if (userRole) userRole.textContent = roleLabel;
        if (userAvatar) userAvatar.textContent = avatar;
    }
};

const API = {
    users: {
        mapUserDocument(snapshot) {
            return {
                id: snapshot.id,
                uid: snapshot.id,
                ...snapshot.data()
            };
        },

        async getById(userId) {
            await App.ready();
            App.assertConfigured();

            const snapshot = await Backend.getDb().collection(COLLECTIONS.USERS).doc(userId).get();
            if (!snapshot.exists) return null;

            return this.mapUserDocument(snapshot);
        },

        async listAll(options = {}) {
            await App.ready();
            App.assertConfigured();

            const currentUser = Auth.getCurrentUser();
            if (currentUser?.role !== "admin") {
                throw new Error("Only administrators can view the full user directory.");
            }

            let query = Backend.getDb().collection(COLLECTIONS.USERS);
            if (options.role) {
                query = query.where("role", "==", options.role);
            }

            const snapshot = await query.get();
            return snapshot.docs
                .map(doc => this.mapUserDocument(doc))
                .filter(user => options.includeArchived ? true : !user.deletedAt)
                .sort((a, b) => (a.fullName || a.name || "").localeCompare(b.fullName || b.name || ""));
        },

        async listStudents() {
            await App.ready();
            App.assertConfigured();

            const currentUser = Auth.getCurrentUser();
            let registrationQuery = Backend.getDb().collection(COLLECTIONS.COURSE_REGISTRATIONS);
            if (currentUser?.role === "lecturer") {
                registrationQuery = registrationQuery.where("lecturerId", "==", currentUser.uid);
            }

            const [studentsSnapshot, attendanceRecords, sessions, courseRegistrationsSnapshot] = await Promise.all([
                Backend.getDb().collection(COLLECTIONS.USERS).where("role", "==", "student").get(),
                API.reports.getAttendanceRecords(),
                API.sessions.list({ includeCompleted: true }),
                registrationQuery.get()
            ]);

            const totalSessions = sessions.filter(session => session.status === "completed" || session.status === "active").length || 1;
            const allRegistrations = courseRegistrationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const visibleStudentIds = new Set(allRegistrations.map(registration => registration.studentId));

            return studentsSnapshot.docs
                .map(doc => this.mapUserDocument(doc))
                .filter(student => !student.deletedAt)
                .filter(student => currentUser?.role === "lecturer" ? visibleStudentIds.has(student.uid) : true)
                .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""))
                .map(student => {
                    const attendanceCount = attendanceRecords.filter(record => record.studentId === student.uid).length;
                    const attendanceRate = Math.round((attendanceCount / totalSessions) * 100);
                    const registeredCourses = allRegistrations.filter(registration => registration.studentId === student.uid);

                    return {
                        ...student,
                        accountStatus: Utils.getAccountStatus(student),
                        registeredCourseCount: registeredCourses.length,
                        attendanceCount,
                        attendanceRate: Number.isFinite(attendanceRate) ? attendanceRate : 0
                    };
                });
        },

        async createManagedUser(userData) {
            await App.ready();
            App.assertConfigured();

            const admin = Auth.getCurrentUser();
            if (admin?.role !== "admin") {
                throw new Error("Only administrators can create users.");
            }

            const role = String(userData.role || "").trim().toLowerCase();
            const email = String(userData.email || "").trim().toLowerCase();
            const password = String(userData.password || "");
            const fullName = String(userData.fullName || "").trim();
            const departmentKey = String(userData.department || "").trim();
            const department = departmentKey ? Utils.normalizeDepartment(departmentKey) : "";
            const level = String(userData.level || "").trim();
            const matricNo = role === "student" ? Utils.normalizeMatricNo(userData.matricNo) : "";
            const matricValidation = role === "student"
                ? Utils.validateMatricNo(matricNo)
                : { valid: true };

            if (!["student", "lecturer", "admin"].includes(role)) {
                throw new Error("Select a valid account type.");
            }
            if (role === "admin" && !admin.isSuperAdmin) {
                throw new Error("Only the superadmin can create administrator accounts.");
            }
            if (!fullName) {
                throw new Error("Enter the user's full name.");
            }
            if (!email) {
                throw new Error("Enter the user's email address.");
            }
            if (password.length < 8) {
                throw new Error("Set a password with at least 8 characters.");
            }
            if (role === "student" && !matricValidation.valid) {
                throw new Error(matricValidation.message);
            }
            if (role === "student" && !level) {
                throw new Error("Select the student's level.");
            }

            const secondaryAppName = "__accountProvisioner";
            const secondaryApp = window.firebase.apps.find(app => app.name === secondaryAppName)
                || window.firebase.initializeApp(window.FIREBASE_CONFIG, secondaryAppName);
            const secondaryAuth = secondaryApp.auth();
            const db = Backend.getDb();
            let createdUser = null;

            try {
                const credential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
                createdUser = credential.user;

                const userRef = db.collection(COLLECTIONS.USERS).doc(createdUser.uid);
                const matricRef = role === "student"
                    ? db.collection(COLLECTIONS.MATRIC_INDEX).doc(matricNo.replace(/\//g, "-"))
                    : null;

                await db.runTransaction(async transaction => {
                    if (matricRef) {
                        const matricSnapshot = await transaction.get(matricRef);
                        if (matricSnapshot.exists) {
                            throw new Error("A student with this matric number already exists.");
                        }

                        transaction.set(matricRef, {
                            matricNo,
                            uid: createdUser.uid,
                            createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }

                    transaction.set(userRef, {
                        uid: createdUser.uid,
                        fullName,
                        name: fullName,
                        email,
                        matricNo,
                        department,
                        departmentKey,
                        level,
                        role,
                        avatar: role === "student" ? "S" : role === "admin" ? "A" : "L",
                        accountStatus: "active",
                        disabled: false,
                        isSuperAdmin: role === "admin" && Utils.isSuperAdminEmail(email),
                        profileCompleted: true,
                        preferences: {
                            notifications: { ...DEFAULT_SYSTEM_SETTINGS.notifications }
                        },
                        createdBy: admin.uid,
                        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                    });
                });

                return {
                    success: true,
                    user: await this.getById(createdUser.uid)
                };
            } catch (error) {
                if (createdUser) {
                    try {
                        await createdUser.delete();
                    } catch (cleanupError) {
                        console.warn("Managed user cleanup failed:", cleanupError);
                    }
                }
                throw error;
            } finally {
                try {
                    await secondaryAuth.signOut();
                } catch (signOutError) {
                    console.warn("Provisioning auth sign-out failed:", signOutError);
                }
            }
        },

        async updateManagedUser(userId, updates = {}) {
            await App.ready();
            App.assertConfigured();

            const admin = Auth.getCurrentUser();
            if (admin?.role !== "admin") {
                throw new Error("Only administrators can update user accounts.");
            }

            const db = Backend.getDb();
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const snapshot = await userRef.get();
            if (!snapshot.exists) {
                throw new Error("That user could not be found.");
            }

            const existingUser = this.mapUserDocument(snapshot);
            if (existingUser.isSuperAdmin && !admin.isSuperAdmin) {
                throw new Error("Only the superadmin can update this account.");
            }

            const nextRole = String(updates.role || existingUser.role || "").trim().toLowerCase();
            if (nextRole === "admin" && !admin.isSuperAdmin) {
                throw new Error("Only the superadmin can assign administrator access.");
            }

            const fullName = String(updates.fullName ?? existingUser.fullName ?? existingUser.name ?? "").trim();
            const departmentKey = String(updates.department ?? existingUser.departmentKey ?? existingUser.department ?? "").trim();
            const department = departmentKey ? Utils.normalizeDepartment(departmentKey) : "";
            const level = nextRole === "student"
                ? String(updates.level ?? existingUser.level ?? "").trim()
                : "";
            const nextMatric = nextRole === "student"
                ? Utils.normalizeMatricNo(updates.matricNo ?? existingUser.matricNo ?? "")
                : "";
            const matricValidation = nextRole === "student"
                ? Utils.validateMatricNo(nextMatric)
                : { valid: true };

            if (!fullName) {
                throw new Error("Enter the user's full name.");
            }
            if (nextRole === "student" && !matricValidation.valid) {
                throw new Error(matricValidation.message);
            }
            if (nextRole === "student" && !level) {
                throw new Error("Select the student's level.");
            }

            const previousMatric = String(existingUser.matricNo || "").trim();
            const nextMatricRef = nextMatric
                ? db.collection(COLLECTIONS.MATRIC_INDEX).doc(nextMatric.replace(/\//g, "-"))
                : null;
            const previousMatricRef = previousMatric
                ? db.collection(COLLECTIONS.MATRIC_INDEX).doc(previousMatric.replace(/\//g, "-"))
                : null;

            await db.runTransaction(async transaction => {
                const nextMatricSnapshot = nextMatricRef ? await transaction.get(nextMatricRef) : null;
                const previousMatricSnapshot = previousMatricRef ? await transaction.get(previousMatricRef) : null;

                if (nextMatricRef && nextMatricSnapshot.exists && nextMatricSnapshot.data()?.uid !== userId) {
                    throw new Error("A student with this matric number already exists.");
                }

                if (previousMatricRef && previousMatric && previousMatric !== nextMatric && previousMatricSnapshot?.exists) {
                    transaction.delete(previousMatricRef);
                }

                if (nextMatricRef) {
                    transaction.set(nextMatricRef, {
                        matricNo: nextMatric,
                        uid: userId,
                        createdAt: nextMatricSnapshot?.exists
                            ? (nextMatricSnapshot.data()?.createdAt || window.firebase.firestore.FieldValue.serverTimestamp())
                            : window.firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }

                transaction.update(userRef, {
                    fullName,
                    name: fullName,
                    department,
                    departmentKey,
                    level,
                    matricNo: nextMatric,
                    role: nextRole,
                    avatar: nextRole === "student" ? "S" : nextRole === "admin" ? "A" : "L",
                    profileCompleted: nextRole === "student" ? !!(fullName && department && level && nextMatric) : true,
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                });
            });

            if (userId === admin.uid) {
                await Auth.refreshCurrentUser();
            }

            return this.getById(userId);
        },

        async setAccountStatus(userId, status) {
            await App.ready();
            App.assertConfigured();

            const admin = Auth.getCurrentUser();
            if (admin?.role !== "admin") {
                throw new Error("Only administrators can change account status.");
            }

            const snapshot = await Backend.getDb().collection(COLLECTIONS.USERS).doc(userId).get();
            if (!snapshot.exists) {
                throw new Error("That user could not be found.");
            }

            const existingUser = this.mapUserDocument(snapshot);
            if (existingUser.isSuperAdmin && !admin.isSuperAdmin) {
                throw new Error("Only the superadmin can change this account.");
            }

            const normalizedStatus = status === "disabled" ? "disabled" : "active";
            await Backend.getDb().collection(COLLECTIONS.USERS).doc(userId).update({
                accountStatus: normalizedStatus,
                disabled: normalizedStatus === "disabled",
                disabledAt: normalizedStatus === "disabled"
                    ? window.firebase.firestore.FieldValue.serverTimestamp()
                    : null,
                disabledBy: normalizedStatus === "disabled" ? admin.uid : null,
                restoredAt: normalizedStatus === "active"
                    ? window.firebase.firestore.FieldValue.serverTimestamp()
                    : null,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            });

            if (userId === admin.uid) {
                await Auth.refreshCurrentUser();
            }

            return this.getById(userId);
        },

        async archiveUser(userId) {
            await App.ready();
            App.assertConfigured();

            const admin = Auth.getCurrentUser();
            if (admin?.role !== "admin") {
                throw new Error("Only administrators can archive users.");
            }

            const db = Backend.getDb();
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const snapshot = await userRef.get();
            if (!snapshot.exists) {
                throw new Error("That user could not be found.");
            }

            const existingUser = this.mapUserDocument(snapshot);
            if (existingUser.isSuperAdmin) {
                throw new Error("The superadmin account cannot be archived.");
            }

            const previousMatric = String(existingUser.matricNo || "").trim();
            const previousMatricRef = previousMatric
                ? db.collection(COLLECTIONS.MATRIC_INDEX).doc(previousMatric.replace(/\//g, "-"))
                : null;

            if (previousMatricRef) {
                const previousMatricSnapshot = await previousMatricRef.get();
                if (previousMatricSnapshot.exists) {
                    await previousMatricRef.delete();
                }
            }

            const registrationSnapshot = await db.collection(COLLECTIONS.COURSE_REGISTRATIONS)
                .where("studentId", "==", userId)
                .get();
            const registrationBatch = db.batch();
            registrationSnapshot.docs.forEach(doc => registrationBatch.delete(doc.ref));
            if (!registrationSnapshot.empty) {
                await registrationBatch.commit();
            }

            await userRef.update({
                accountStatus: "archived",
                disabled: true,
                deletedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                deletedBy: admin.uid,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            });

            return { success: true };
        }
    },

    courses: {
        async upsertFromSession(sessionData) {
            await App.ready();
            App.assertConfigured();

            const user = Auth.getCurrentUser();
            const courseId = Utils.slugify(sessionData.courseCode);
            const ref = Backend.getDb().collection(COLLECTIONS.COURSES).doc(courseId);
            const snapshot = await ref.get();
            const payload = {
                code: sessionData.courseCode,
                title: sessionData.courseTitle,
                lecturerId: user?.uid || "",
                lecturerName: user?.name || "",
                department: user?.department || "",
                level: sessionData.level?.trim() || snapshot.data()?.level || "",
                expectedStudentCount: Math.max(sessionData.expectedStudents || 0, snapshot.data()?.expectedStudentCount || 0),
                studentCount: Math.max(sessionData.expectedStudents || 0, snapshot.data()?.studentCount || 0),
                active: true,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            };

            if (!snapshot.exists) {
                payload.createdAt = window.firebase.firestore.FieldValue.serverTimestamp();
            }

            await ref.set(payload, { merge: true });
            return courseId;
        },

        async create(courseData) {
            await App.ready();
            App.assertConfigured();

            const user = Auth.getCurrentUser();
            const courseId = Utils.slugify(courseData.code);
            const ref = Backend.getDb().collection(COLLECTIONS.COURSES).doc(courseId);
            const snapshot = await ref.get();

            if (snapshot.exists) {
                throw new Error("A course with this code already exists.");
            }

            await ref.set({
                code: courseData.code.toUpperCase(),
                title: courseData.title.trim(),
                lecturerName: courseData.lecturerName?.trim() || user?.name || "",
                lecturerId: user?.uid || "",
                department: courseData.department?.trim() || user?.department || "",
                level: String(courseData.level || "").trim(),
                expectedStudentCount: Number(courseData.studentCount || 0),
                studentCount: Number(courseData.studentCount || 0),
                active: true,
                createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            });

            return { id: courseId, code: courseData.code.toUpperCase(), title: courseData.title.trim() };
        },

        async list() {
            await App.ready();
            App.assertConfigured();

            const currentUser = Auth.getCurrentUser();
            let courseQuery = Backend.getDb().collection(COLLECTIONS.COURSES);
            let registrationQuery = Backend.getDb().collection(COLLECTIONS.COURSE_REGISTRATIONS);

            if (currentUser?.role === "lecturer") {
                courseQuery = courseQuery.where("lecturerId", "==", currentUser.uid);
                registrationQuery = registrationQuery.where("lecturerId", "==", currentUser.uid);
            }

            const [courseSnapshot, sessions, registrationsSnapshot] = await Promise.all([
                courseQuery.get(),
                API.sessions.list({ includeCompleted: true }),
                registrationQuery.get()
            ]);
            const registrations = registrationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const courseMap = courseSnapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(course => !course.deletedAt)
                .sort((a, b) => (a.code || "").localeCompare(b.code || ""));

            return courseMap.map(course => {
                const courseSessions = sessions.filter(session => session.courseCode === course.code);
                const sessionCount = courseSessions.length;
                const registeredStudents = registrations.filter(registration => registration.courseId === course.id).length;
                const avgAttendance = sessionCount
                    ? Math.round(courseSessions.reduce((sum, session) => sum + (session.attendanceRate || 0), 0) / sessionCount)
                    : 0;

                return {
                    ...course,
                    studentCount: registeredStudents,
                    sessionCount,
                    avgAttendance
                };
            });
        },

        async listForStudent() {
            await App.ready();
            App.assertConfigured();

            const currentUser = Auth.getCurrentUser();
            if (!currentUser || currentUser.role !== "student") {
                return [];
            }

            const [courseSnapshot, registrationsSnapshot] = await Promise.all([
                Backend.getDb().collection(COLLECTIONS.COURSES).where("active", "==", true).get(),
                Backend.getDb().collection(COLLECTIONS.COURSE_REGISTRATIONS)
                    .where("studentId", "==", currentUser.uid)
                    .get()
            ]);

            const registeredCourseIds = new Set(registrationsSnapshot.docs.map(doc => doc.data().courseId));

            return courseSnapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(course => !currentUser.level || course.level === currentUser.level)
                .sort((a, b) => (a.code || "").localeCompare(b.code || ""))
                .map(course => ({
                    ...course,
                    registered: registeredCourseIds.has(course.id)
                }));
        },

        async registerStudent(courseId) {
            await App.ready();
            App.assertConfigured();

            const student = Auth.getCurrentUser();
            if (!student || student.role !== "student") {
                throw new Error("Only students can register courses.");
            }

            if (Auth.needsStudentProfileCompletion(student)) {
                throw new Error("Complete your profile before registering courses.");
            }

            const db = Backend.getDb();
            const courseRef = db.collection(COLLECTIONS.COURSES).doc(courseId);
            const registrationRef = db.collection(COLLECTIONS.COURSE_REGISTRATIONS).doc(`${courseId}_${student.uid}`);

            await db.runTransaction(async transaction => {
                const [courseSnapshot, registrationSnapshot] = await Promise.all([
                    transaction.get(courseRef),
                    transaction.get(registrationRef)
                ]);

                if (!courseSnapshot.exists) {
                    throw new Error("That course could not be found.");
                }

                const course = courseSnapshot.data();

                if (course.level && student.level !== course.level) {
                    throw new Error("You can only register courses for your level.");
                }

                if (registrationSnapshot.exists) {
                    throw new Error("You have already registered this course.");
                }

                transaction.set(registrationRef, {
                    courseId,
                    courseCode: course.code,
                    courseTitle: course.title,
                    lecturerId: course.lecturerId || "",
                    lecturerName: course.lecturerName || "",
                    level: course.level || "",
                    studentId: student.uid,
                    studentName: student.fullName || student.name || "",
                    studentEmail: student.email || "",
                    studentLevel: student.level || "",
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
                });
            });

            return {
                success: true,
                message: "Course registered successfully."
            };
        }
    },

    sessions: {
        async create(sessionData) {
            await App.ready();
            App.assertConfigured();

            const user = Auth.getCurrentUser();
            const settings = await API.settings.getSystemSettings();
            const now = new Date();
            const requestedStartTime = sessionData.startTime ? new Date(sessionData.startTime) : now;
            const startTime = Number.isNaN(requestedStartTime.getTime()) ? now : requestedStartTime;
            const qrToken = Utils.randomString(36);
            const manualCode = Utils.generateManualCode();
            const duration = Number(sessionData.duration || 0);
            const expectedStudents = Number(sessionData.expectedStudents || sessionData.totalStudents || 0);

            const courseId = await API.courses.upsertFromSession({
                ...sessionData,
                expectedStudents
            });

            const docRef = Backend.getDb().collection(COLLECTIONS.SESSIONS).doc();
            const payload = {
                courseId,
                courseCode: sessionData.courseCode.trim().toUpperCase(),
                courseTitle: sessionData.courseTitle.trim(),
                venue: sessionData.venue.trim(),
                lecturerId: user?.uid || "",
                lecturer: user?.name || "Lecturer",
                lecturerName: user?.name || "Lecturer",
                duration,
                totalStudents: expectedStudents,
                expectedStudents,
                attendanceCount: 0,
                status: startTime > now ? "upcoming" : "active",
                startTime,
                qrToken,
                qrIssuedAt: now,
                qrExpiresAt: new Date(now.getTime() + settings.qrRefreshIntervalSeconds * 1000),
                manualCode,
                createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            };

            await docRef.set(payload);
            return {
                success: true,
                message: "Session created successfully",
                session: await this.getById(docRef.id)
            };
        },

        async list(options = {}) {
            await App.ready();
            App.assertConfigured();

            const user = Auth.getCurrentUser();
            let query = Backend.getDb()
                .collection(COLLECTIONS.SESSIONS)
                .orderBy("startTime", "desc")
                .limit(options.limit || 200);

            if (user?.role === "lecturer") {
                query = Backend.getDb()
                    .collection(COLLECTIONS.SESSIONS)
                    .where("lecturerId", "==", user.uid)
                    .orderBy("startTime", "desc")
                    .limit(options.limit || 200);
            }

            const snapshot = await query.get();

            const sessions = snapshot.docs.map(doc => this.mapSession(doc.id, doc.data()));
            const visibleSessions = sessions.filter(session => !session.deletedAt);

            await this.syncExpiredSessions(visibleSessions);

            return visibleSessions
                .map(session => this.decorateSession(session))
                .filter(session => options.includeCompleted ? true : session.status !== "completed" || session.attendanceCount >= 0);
        },

        async getById(sessionId) {
            await App.ready();
            App.assertConfigured();

            const snapshot = await Backend.getDb().collection(COLLECTIONS.SESSIONS).doc(sessionId).get();
            if (!snapshot.exists) return null;

            return this.decorateSession(this.mapSession(snapshot.id, snapshot.data()));
        },

        async end(sessionId) {
            await App.ready();
            App.assertConfigured();

            await Backend.getDb().collection(COLLECTIONS.SESSIONS).doc(sessionId).update({
                status: "completed",
                endedAt: new Date(),
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            });

            return {
                success: true,
                message: "Session ended successfully"
            };
        },

        async remove(sessionId) {
            await App.ready();
            App.assertConfigured();

            await Backend.getDb().collection(COLLECTIONS.SESSIONS).doc(sessionId).delete();
            return {
                success: true,
                message: "Session removed successfully"
            };
        },

        async refreshQR(sessionId) {
            await App.ready();
            App.assertConfigured();

            const settings = await API.settings.getSystemSettings();
            const qrToken = Utils.randomString(36);
            const qrIssuedAt = new Date();
            const qrExpiresAt = new Date(qrIssuedAt.getTime() + settings.qrRefreshIntervalSeconds * 1000);

            await Backend.getDb().collection(COLLECTIONS.SESSIONS).doc(sessionId).update({
                qrToken,
                qrIssuedAt,
                qrExpiresAt,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            });

            return {
                success: true,
                qrToken,
                expiresAt: qrExpiresAt.toISOString()
            };
        },

        async resolveScanToken(scanCode) {
            await App.ready();
            App.assertConfigured();

            const db = Backend.getDb();
            const normalizedInput = String(scanCode || "").trim();
            const qrPayload = Utils.parseQrPayload(normalizedInput);
            const manualCodeCandidate = normalizedInput.replace(/^manual_/i, "").replace(/\D/g, "");
            const isManualEntry = /^manual_/i.test(normalizedInput) || /^\d{6}$/.test(manualCodeCandidate);
            const normalizedCode = isManualEntry ? manualCodeCandidate : qrPayload.qrToken;
            const encodedSessionId = qrPayload.sessionId || "";

            let snapshot = null;

            if (encodedSessionId) {
                const directDoc = await db.collection(COLLECTIONS.SESSIONS).doc(encodedSessionId).get();
                if (directDoc.exists && directDoc.data()?.qrToken === qrPayload.qrToken) {
                    snapshot = {
                        empty: false,
                        docs: [directDoc]
                    };
                }
            }

            if (!snapshot) {
                snapshot = await db.collection(COLLECTIONS.SESSIONS)
                    .where("qrToken", "==", qrPayload.qrToken)
                    .limit(1)
                    .get();
            }

            if (snapshot.empty) {
                snapshot = await db.collection(COLLECTIONS.SESSIONS)
                    .where("manualCode", "==", normalizedCode)
                    .limit(1)
                    .get();
            }

            if (snapshot.empty) {
                return null;
            }

            const session = this.decorateSession(this.mapSession(snapshot.docs[0].id, snapshot.docs[0].data()));
            if (session.status !== "active") {
                throw new Error("This session is no longer active.");
            }

            if (session.qrExpiresAt && new Date(session.qrExpiresAt) < new Date() && !isManualEntry) {
                throw new Error("QR code has expired. Please ask your lecturer to refresh it.");
            }

            return session;
        },

        async syncExpiredSessions(sessions) {
            const settings = App.getSystemSettings();
            if (!settings.sessionAutoExpiry) return;

            const expired = sessions.filter(session => session.status === "active" && new Date(session.endTime) <= new Date());
            if (!expired.length) return;

            await Promise.all(expired.map(session =>
                Backend.getDb().collection(COLLECTIONS.SESSIONS).doc(session.id).update({
                    status: "completed",
                    endedAt: new Date(session.endTime),
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                })
            ));
        },

        mapSession(id, data) {
            const mapped = {
                id,
                ...data,
                startTime: Utils.toIsoString(data.startTime),
                qrIssuedAt: Utils.toIsoString(data.qrIssuedAt),
                qrExpiresAt: Utils.toIsoString(data.qrExpiresAt),
                endedAt: Utils.toIsoString(data.endedAt)
            };

            mapped.qrPayload = Utils.buildQrPayload(mapped);
            return mapped;
        },

        decorateSession(session) {
            const startTime = new Date(session.startTime);
            const endTime = new Date(startTime.getTime() + Number(session.duration || 0) * 60000);
            const totalStudents = Number(session.totalStudents || session.expectedStudents || 0);
            const attendanceCount = Number(session.attendanceCount || 0);
            const now = new Date();
            let derivedStatus = session.status;

            if (derivedStatus !== "completed") {
                if (endTime <= now) {
                    derivedStatus = "completed";
                } else if (startTime > now) {
                    derivedStatus = "upcoming";
                } else {
                    derivedStatus = "active";
                }
            }

            return {
                ...session,
                status: derivedStatus,
                totalStudents,
                expectedStudents: totalStudents,
                attendanceCount,
                attendanceRate: totalStudents > 0 ? Math.round((attendanceCount / totalStudents) * 100) : 0,
                endTime: endTime.toISOString(),
                isExpired: endTime <= now,
                qrPayload: Utils.buildQrPayload(session)
            };
        }
    },

    attendance: {
        async mark(attendanceData) {
            await App.ready();
            App.assertConfigured();

            const student = Auth.getCurrentUser();
            if (!student) {
                throw new Error("Please sign in before scanning attendance.");
            }

            const normalizedManualCode = String(attendanceData.manualCode || "").trim().replace(/\D/g, "");
            const normalizedQrToken = String(attendanceData.qrToken || "").trim();
            const session = attendanceData.sessionId
                ? await API.sessions.getById(attendanceData.sessionId)
                : await API.sessions.resolveScanToken(normalizedManualCode || normalizedQrToken || "");

            if (!session) {
                throw new Error("That QR code or manual code is not valid.");
            }

            const settings = await API.settings.getSystemSettings();
            const scanTime = new Date();
            const lateThresholdMs = settings.lateThresholdMinutes * 60 * 1000;
            const status = scanTime.getTime() - new Date(session.startTime).getTime() > lateThresholdMs ? "late" : "present";
            const attendanceId = `${session.id}_${student.uid}`;
            const attendanceRef = Backend.getDb().collection(COLLECTIONS.ATTENDANCE).doc(attendanceId);
            const sessionRef = Backend.getDb().collection(COLLECTIONS.SESSIONS).doc(session.id);

            await Backend.getDb().runTransaction(async transaction => {
                const [attendanceSnapshot, sessionSnapshot] = await Promise.all([
                    transaction.get(attendanceRef),
                    transaction.get(sessionRef)
                ]);

                if (attendanceSnapshot.exists) {
                    throw new Error("You have already marked attendance for this session.");
                }

                const latestSession = API.sessions.decorateSession(API.sessions.mapSession(sessionSnapshot.id, sessionSnapshot.data()));
                if (latestSession.status !== "active") {
                    throw new Error("This session is no longer active.");
                }

                if (new Date(latestSession.endTime) <= new Date()) {
                    throw new Error("This session has already expired.");
                }

                transaction.set(attendanceRef, {
                    sessionId: latestSession.id,
                    studentId: student.uid,
                    studentName: student.name || student.fullName,
                    matricNo: student.matricNo || "",
                    courseCode: latestSession.courseCode,
                    courseTitle: latestSession.courseTitle,
                    lecturerId: latestSession.lecturerId,
                    venue: latestSession.venue,
                    status,
                    timestamp: scanTime,
                    qrToken: normalizedQrToken,
                    manualCodeUsed: normalizedManualCode,
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
                });

                transaction.update(sessionRef, {
                    attendanceCount: Number(latestSession.attendanceCount || 0) + 1,
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                });
            });

            return {
                success: true,
                message: "Attendance marked successfully",
                attendance: {
                    sessionId: session.id,
                    courseCode: session.courseCode,
                    courseTitle: session.courseTitle,
                    status,
                    timestamp: scanTime.toISOString()
                }
            };
        },

        async getLiveFeed(limit = 10) {
            await App.ready();
            App.assertConfigured();

            const records = await API.reports.getAttendanceRecords({ limit: Math.max(limit, 20) });
            return {
                success: true,
                checkIns: records.slice(0, limit)
            };
        }
    },

    reports: {
        async getDashboard() {
            await App.ready();
            App.assertConfigured();

            const [students, sessions, attendanceRecords] = await Promise.all([
                API.users.listStudents(),
                API.sessions.list({ includeCompleted: true }),
                this.getAttendanceRecords({ limit: 250 })
            ]);

            const activeSessions = sessions.filter(session => session.status === "active" && !session.isExpired);
            const visibleSessionIds = new Set(sessions.map(session => session.id));
            const visibleAttendance = attendanceRecords.filter(record => visibleSessionIds.has(record.sessionId));
            const todayAttendance = visibleAttendance.filter(record => Utils.isSameDay(record.timestamp));
            const recentActivity = visibleAttendance.slice(0, 10);
            const denominator = activeSessions.reduce((sum, session) => sum + (session.totalStudents || 0), 0);
            const numerator = activeSessions.reduce((sum, session) => sum + (session.attendanceCount || 0), 0);
            const attendanceRate = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;

            return {
                success: true,
                data: {
                    stats: {
                        totalStudents: students.length,
                        activeSessions: activeSessions.length,
                        todayAttendance: todayAttendance.length,
                        attendanceRate
                    },
                    sessions: activeSessions,
                    recentActivity,
                    analytics: this.buildAnalytics(sessions, visibleAttendance)
                }
            };
        },

        async getAttendanceRecords(options = {}) {
            await App.ready();
            App.assertConfigured();

            const user = Auth.getCurrentUser();
            let query = Backend.getDb()
                .collection(COLLECTIONS.ATTENDANCE)
                .orderBy("timestamp", "desc")
                .limit(options.limit || 500);

            if (user?.role === "lecturer") {
                query = Backend.getDb()
                    .collection(COLLECTIONS.ATTENDANCE)
                    .where("lecturerId", "==", user.uid)
                    .orderBy("timestamp", "desc")
                    .limit(options.limit || 500);
            }

            if (user?.role === "student") {
                query = Backend.getDb()
                    .collection(COLLECTIONS.ATTENDANCE)
                    .where("studentId", "==", user.uid)
                    .orderBy("timestamp", "desc")
                    .limit(options.limit || 500);
            }

            const snapshot = await query.get();
            const records = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: Utils.toIsoString(doc.data().timestamp)
            }));

            return records;
        },

        buildAnalytics(sessions, attendanceRecords) {
            const labels = [];
            const attendance = [];
            const sessionCounts = [];

            for (let offset = 6; offset >= 0; offset -= 1) {
                const day = new Date();
                day.setHours(0, 0, 0, 0);
                day.setDate(day.getDate() - offset);

                const label = day.toLocaleDateString("en-US", { weekday: "short" });
                labels.push(label);

                attendance.push(attendanceRecords.filter(record => {
                    const recordDate = Utils.toDate(record.timestamp);
                    return recordDate && recordDate.toDateString() === day.toDateString();
                }).length);

                sessionCounts.push(sessions.filter(session => {
                    const sessionDate = Utils.toDate(session.startTime);
                    return sessionDate && sessionDate.toDateString() === day.toDateString();
                }).length);
            }

            return { labels, attendance, sessions: sessionCounts };
        }
    },

    settings: {
        async getSystemSettings() {
            await App.ready();
            App.assertConfigured();

            const ref = Backend.getDb().collection(COLLECTIONS.SETTINGS).doc("system");
            const snapshot = await ref.get();

            if (!snapshot.exists) {
                await ref.set({
                    ...DEFAULT_SYSTEM_SETTINGS,
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                });

                AppState.currentSystemSettings = { ...DEFAULT_SYSTEM_SETTINGS };
                return AppState.currentSystemSettings;
            }

            const settings = {
                ...DEFAULT_SYSTEM_SETTINGS,
                ...snapshot.data()
            };

            AppState.currentSystemSettings = settings;
            return Utils.copy(settings);
        },

        async saveSystemSettings(settingsUpdates) {
            await App.ready();
            App.assertConfigured();

            const payload = {
                ...DEFAULT_SYSTEM_SETTINGS,
                ...AppState.currentSystemSettings,
                ...settingsUpdates,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            };

            await Backend.getDb().collection(COLLECTIONS.SETTINGS).doc("system").set(payload, { merge: true });
            AppState.currentSystemSettings = {
                ...DEFAULT_SYSTEM_SETTINGS,
                ...AppState.currentSystemSettings,
                ...settingsUpdates
            };

            return Utils.copy(AppState.currentSystemSettings);
        },

        async saveUserNotifications(notificationUpdates) {
            await App.ready();
            App.assertConfigured();

            const currentUser = Auth.getCurrentUser();
            if (!currentUser) {
                throw new Error("Please sign in again before saving preferences.");
            }

            await Backend.getDb().collection(COLLECTIONS.USERS).doc(currentUser.uid).set({
                preferences: {
                    notifications: {
                        ...DEFAULT_SYSTEM_SETTINGS.notifications,
                        ...(currentUser.preferences?.notifications || {}),
                        ...notificationUpdates
                    }
                },
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            await Auth.refreshCurrentUser();
            return Auth.getCurrentUser().preferences?.notifications || { ...DEFAULT_SYSTEM_SETTINGS.notifications };
        }
    }
};

document.addEventListener("DOMContentLoaded", () => {
    Page.bindCommonUi();
    window.addEventListener("beforeunload", () => {
        CountdownTimer.stopAll();
    });
});

window.APP_CONFIG = APP_CONFIG;
window.App = App;
window.API = API;
window.Auth = Auth;
window.UI = UI;
window.DarkMode = DarkMode;
window.CountdownTimer = CountdownTimer;
window.ExportModule = ExportModule;
window.SearchFilter = SearchFilter;
window.Page = Page;
window.DataStore = DataStore;


    // ==================== CURRENCY SYSTEM ====================
    // FIX #2: Global currency state with symbol map
    let currentCurrency = 'USD';
    const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', INR: '₹' };

    function getCurrencySymbol() {
        return CURRENCY_SYMBOLS[currentCurrency] || '$';
    }

    // Central price formatter — use this everywhere instead of hardcoding '$'
    function formatPrice(amount, compact = false) {
        const sym = getCurrencySymbol();
        const num = Number(amount || 0);
        if (compact) {
            if (num >= 1000000) return sym + (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return sym + (num / 1000).toFixed(1) + 'K';
            return sym + num.toFixed(2);
        }
        return sym + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Updates price label in the product modal dynamically
    function updatePriceLabel() {
        const lbl = document.getElementById('price-label');
        if (lbl) lbl.textContent = `Unit Price (${getCurrencySymbol()}) *`;
    }

    // ==================== FIREBASE INIT ====================
    // FIX #1: Hardcoded config — boots directly, no user input needed
    let db, auth, currentUser;
    let lowStockThreshold = 10;

    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyC544NJDtUNhncGh16-5rQ7fGmo7GNHljg",
        authDomain: "stockmaster-5253.firebaseapp.com",
        projectId: "stockmaster-5253",
        storageBucket: "stockmaster-5253.firebasestorage.app",
        messagingSenderId: "662500206224",
        appId: "1:662500206224:web:31fe7c712cb52cf5359a15",
        measurementId: "G-7KTV2S9GDX"
    };

    function bootFirebase() {
        if (typeof firebase === 'undefined') {
            // Firebase CDN failed to load (network issue, ad-blocker, or offline)
            const loginPage = document.getElementById('login-page');
            if (loginPage) {
                const errDiv = document.createElement('div');
                errDiv.className = 'fixed top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-xl shadow-lg text-sm font-medium z-[200] flex items-center gap-2';
                errDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Firebase failed to load. Check your internet connection or disable ad-blockers, then refresh.';
                document.body.appendChild(errDiv);
            }
            console.error('Firebase SDK not loaded. Ensure gstatic.com is reachable.');
            return;
        }
        try {
            if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
            db = firebase.firestore();
            auth = firebase.auth();
            setupAuthListener();
        } catch (e) {
            showToast('Firebase init failed: ' + e.message, 'error');
            console.error(e);
        }
    }

// ==================== AUTH LISTENER ====================
    function setupAuthListener() {
        auth.onAuthStateChanged(async user => {
            if (user) {
                currentUser = user;
                document.getElementById('login-page').classList.add('hidden');
                document.getElementById('app-container').classList.remove('hidden');
                updateSidebarUser(user);
                await ensureUserRecord(user);
                await loadSettings();
                subscribeAll();
                applyProfitBannerPreference();
            } else {
                currentUser = null;
                document.getElementById('app-container').classList.add('hidden');
                document.getElementById('login-page').classList.remove('hidden');
            }
        });
    }

    async function ensureUserRecord(user) {
        const ref = db.collection('users').doc(user.uid);
        const snap = await ref.get();
        if (!snap.exists) {
            await ref.set({
                name: user.displayName || user.email.split('@')[0],
                email: user.email,
                photoURL: user.photoURL || '',
                provider: user.providerData[0]?.providerId || 'email',
                role: 'Admin',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastActive: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            await ref.update({ lastActive: firebase.firestore.FieldValue.serverTimestamp() });
        }
    }

    function updateSidebarUser(user) {
        const name = user.displayName || user.email.split('@')[0];
        const avatarUrl = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff&size=128`;
        document.getElementById('sidebar-name').textContent = name;
        document.getElementById('sidebar-email').textContent = user.email;
        document.getElementById('sidebar-avatar').src = avatarUrl;
    }

    // ==================== AUTH ACTIONS ====================
    let currentTab = 'signin';
    function switchTab(tab) {
        currentTab = tab;
        ['signin', 'signup'].forEach(t => {
            document.getElementById(`${t}-form-wrapper`).classList.toggle('hidden', t !== tab);
            const btn = document.getElementById(`tab-${t}`);
            if (t === tab) { btn.classList.add('bg-white','shadow','text-gray-800'); btn.classList.remove('text-gray-500'); }
            else { btn.classList.remove('bg-white','shadow','text-gray-800'); btn.classList.add('text-gray-500'); }
        });
    }

    async function handleEmailSignIn(e) {
        e.preventDefault();
        const btn = document.getElementById('signin-btn');
        const err = document.getElementById('signin-error');
        setLoading(btn, true);
        err.classList.add('hidden');
        try {
            await auth.signInWithEmailAndPassword(
                document.getElementById('login-email').value,
                document.getElementById('login-password').value
            );
        } catch (ex) {
            console.log('AUTH ERROR CODE:', ex.code);
            err.textContent = friendlyAuthError(ex.code);
            err.classList.remove('hidden');
            setLoading(btn, false);
        }
    }

    async function handleEmailSignUp(e) {
        e.preventDefault();
        const btn = document.getElementById('signup-btn');
        const err = document.getElementById('signup-error');
        setLoading(btn, true);
        err.classList.add('hidden');
        try {
            const cred = await auth.createUserWithEmailAndPassword(
                document.getElementById('signup-email').value,
                document.getElementById('signup-password').value
            );
            await cred.user.updateProfile({ displayName: document.getElementById('signup-name').value });
        } catch (ex) {
            console.log('AUTH ERROR CODE:', ex.code);
            err.textContent = friendlyAuthError(ex.code);
            err.classList.remove('hidden');
            setLoading(btn, false);
        }
    }

    async function handleGoogleSignIn() {
        const btn = document.getElementById('google-btn');
        setLoading(btn, true, 'Continue with Google');
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
        } catch (ex) {
            console.log('GOOGLE AUTH ERROR:', ex.code);
            showToast(friendlyAuthError(ex.code), 'error');
            setLoading(btn, false, 'Continue with Google');
        }
    }

    async function handleForgotPassword() {
        const email = document.getElementById('login-email').value;
        if (!email) { showToast('Enter your email first', 'warning'); return; }
        try {
            await auth.sendPasswordResetEmail(email);
            showToast('Password reset email sent!', 'success');
        } catch (ex) { showToast(friendlyAuthError(ex.code), 'error'); }
    }

    async function logout() {
        if (confirm('Are you sure you want to sign out?')) {
            await auth.signOut();
            showToast('Signed out successfully', 'success');
        }
    }

    function friendlyAuthError(code) {
        const map = {
            'auth/user-not-found': 'No account with this email.',
            'auth/wrong-password': 'Incorrect password.',
            'auth/invalid-credential': 'Invalid email or password. Check your credentials.',
            'auth/invalid-login-credentials': 'Invalid email or password.',
            'auth/email-already-in-use': 'Email already registered.',
            'auth/weak-password': 'Password must be at least 6 characters.',
            'auth/invalid-email': 'Invalid email address.',
            'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
            'auth/network-request-failed': 'Network error. Check connection.',
            'auth/too-many-requests': 'Too many attempts. Try again later.',
            'auth/operation-not-allowed': 'This sign-in method is not enabled. Enable it in Firebase Console.'
        };
        return map[code] || `Authentication failed (${code}). Try again.`;
    }

    // ==================== REALTIME SUBSCRIPTIONS ====================
    let products = [], categories = [], suppliers = [], orders = [], users_list = [], activities = [];
    let unsubs = [];

    function subscribeAll() {
        unsubs.forEach(u => u());
        unsubs = [];
        const uid = currentUser.uid;
        const base = db.collection('workspaces').doc(uid);

        unsubs.push(base.collection('products').orderBy('createdAt','desc').onSnapshot(snap => {
            products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderInventory(); renderDashboard(); renderCharts(); updateStats();
        }));
        unsubs.push(base.collection('categories').orderBy('name').onSnapshot(snap => {
            categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderCategories(); populateProductDropdowns(); updateStats();
        }));
        unsubs.push(base.collection('suppliers').orderBy('name').onSnapshot(snap => {
            suppliers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderSuppliers(); populateProductDropdowns();
        }));
        unsubs.push(base.collection('orders').orderBy('createdAt','desc').onSnapshot(snap => {
            orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderOrders(); updateStats();
        }));
        unsubs.push(db.collection('users').orderBy('lastActive','desc').onSnapshot(snap => {
            users_list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderUsers();
        }));
        unsubs.push(base.collection('activities').orderBy('time','desc').limit(10).onSnapshot(snap => {
            activities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderActivityList();
        }));
        unsubs.push(base.collection('purchases').orderBy('createdAt','desc').onSnapshot(snap => {
            purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            updateStats();
            renderPurchases();
        }));
        unsubs.push(base.collection('sales').orderBy('createdAt','desc').onSnapshot(snap => {
            sales_list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            updateStats();
            renderSales();
        }));
        unsubs.push(base.collection('adjustments').orderBy('createdAt','desc').onSnapshot(snap => {
            adjustments_list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderAdjustments();
        }));
    }

    async function logActivity(action, item, icon='fa-circle-info', color='text-blue-500', bg='bg-blue-50') {
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('activities').add({
                action, item, icon, color, bg, time: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) { console.warn('Activity log failed', e); }
    }

    // ==================== SETTINGS ====================
    // FIX #2: Load currency into global var and re-render everything
    async function loadSettings() {
        try {
            const snap = await db.collection('workspaces').doc(currentUser.uid).collection('settings').doc('general').get();
            if (snap.exists) {
                const d = snap.data();
                document.getElementById('settings-company').value = d.company || '';
                document.getElementById('settings-currency').value = d.currency || 'USD';
                document.getElementById('settings-threshold').value = d.threshold || 10;
                lowStockThreshold = d.threshold || 10;

                // Apply currency globally
                currentCurrency = d.currency || 'USD';
                applyCompanyName(d.company || '');
                updatePriceLabel();
            }
        } catch (e) { console.warn('Settings load failed', e); }
    }

    async function saveSettings() {
        const data = {
            company: document.getElementById('settings-company').value,
            currency: document.getElementById('settings-currency').value,
            threshold: parseInt(document.getElementById('settings-threshold').value) || 10
        };
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('settings').doc('general').set(data);
            lowStockThreshold = data.threshold;

            // FIX #2: Update global currency and re-render all price displays
            currentCurrency = data.currency;
            applyCompanyName(data.company);
            updatePriceLabel();

            // Re-render all sections that show prices
            renderInventory();
            renderCategories();
            renderOrders();
            renderCharts();
            updateStats();

            showToast(`Settings saved! Currency set to ${data.currency} (${getCurrencySymbol()})`, 'success');
        } catch (e) { showToast('Failed to save settings', 'error'); }
    }

    function applyCompanyName(name) {
        const el = document.getElementById('sidebar-company-name');
        if (el) el.textContent = name || 'StockMaster';
    }

    // ==================== NAVIGATION ====================
    function showSection(section) {
        document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
        document.getElementById(section + '-section').classList.remove('hidden');
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active','text-white');
            item.classList.add('text-gray-400');
            if (item.dataset.section === section) {
                item.classList.add('active','text-white');
                item.classList.remove('text-gray-400');
            }
        });
        const titles = {
            'dashboard': { title: 'Dashboard', subtitle: 'Overview of your inventory system' },
            'inventory': { title: 'Products', subtitle: 'Manage your products and stock levels' },
            'categories': { title: 'Categories', subtitle: 'Organize products by category' },
            'suppliers': { title: 'Suppliers', subtitle: 'Manage supplier relationships' },
            'purchases': { title: 'Purchases', subtitle: 'Record incoming stock (Stock In)' },
            'sales': { title: 'Sales', subtitle: 'Record outgoing stock (Stock Out)' },
            'adjustments': { title: 'Stock Adjustments', subtitle: 'Handle damaged, missing or extra stock' },
            'orders': { title: 'Purchase Orders', subtitle: 'Track and manage orders' },
            'reports': { title: 'Reports & Analytics', subtitle: 'Insights and performance metrics' },
            'users': { title: 'User Management', subtitle: 'Manage team members' },
            'settings': { title: 'System Settings', subtitle: 'Configure application preferences' }
        };
        document.getElementById('page-title').textContent = titles[section]?.title || section;
        document.getElementById('page-subtitle').textContent = titles[section]?.subtitle || '';
        if (window.innerWidth < 1024) document.getElementById('sidebar').classList.add('-translate-x-full');
        if (section === 'reports') renderCharts();
        if (section === 'purchases') renderPurchases();
        if (section === 'sales') renderSales();
        if (section === 'adjustments') renderAdjustments();
    }

    function toggleSidebar() { document.getElementById('sidebar').classList.toggle('-translate-x-full'); }

    // ==================== DASHBOARD ====================
    function renderDashboard() {
        if (categories.length === 0 || products.length === 0) {
            document.getElementById('main-chart').innerHTML = '<div class="empty-state w-full"><i class="fas fa-chart-bar"></i><p>Add categories & products to see chart</p></div>';
            return;
        }
        const catData = categories.map(c => {
            const total = products.filter(p => p.category === c.name).reduce((a, p) => a + (p.quantity || 0), 0);
            return { name: c.name, total };
        }).filter(d => d.total > 0);
        const maxVal = Math.max(...catData.map(d => d.total), 1);
        const colors = ['bg-blue-500','bg-purple-500','bg-amber-500','bg-emerald-500','bg-rose-500','bg-cyan-500'];
        document.getElementById('main-chart').innerHTML = catData.map((d, i) => `
            <div class="flex flex-col items-center gap-2 group cursor-pointer flex-1" title="${d.name}: ${d.total} units">
                <span class="text-xs font-bold text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">${d.total}</span>
                <div class="w-full ${colors[i % colors.length]} rounded-t-lg transition-all duration-500 opacity-80 hover:opacity-100" style="height:${Math.max((d.total / maxVal) * 220, 8)}px"></div>
                <span class="text-xs text-gray-500 text-center truncate w-full">${d.name}</span>
            </div>`).join('');
    }

    function renderActivityList() {
        const list = document.getElementById('activity-list');
        if (!activities.length) { list.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>No recent activity</p></div>'; return; }
        list.innerHTML = activities.map(a => `
            <div class="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
                <div class="w-9 h-9 ${a.bg||'bg-blue-50'} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas ${a.icon||'fa-circle-info'} ${a.color||'text-blue-500'} text-sm"></i></div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-800">${a.action}</p>
                    <p class="text-sm text-gray-500 truncate">${a.item}</p>
                    <p class="text-xs text-gray-400 mt-0.5">${a.time?.toDate ? timeAgo(a.time.toDate()) : 'just now'}</p>
                </div>
            </div>`).join('');
    }

    function timeAgo(date) {
        const secs = Math.floor((new Date() - date) / 1000);
        if (secs < 60) return 'just now';
        if (secs < 3600) return Math.floor(secs / 60) + ' min ago';
        if (secs < 86400) return Math.floor(secs / 3600) + ' hour(s) ago';
        return Math.floor(secs / 86400) + ' day(s) ago';
    }

    // ==================== INVENTORY ====================
    let currentPage = 1;
    const itemsPerPage = 8;
    let currentSort = { field: null, dir: 'asc' };
    let filteredProducts = [];

    function renderInventory() {
        filteredProducts = getFilteredProducts();
        if (currentSort.field) {
            filteredProducts.sort((a, b) => {
                let va = a[currentSort.field], vb = b[currentSort.field];
                if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
                return currentSort.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
            });
        }
        const start = (currentPage - 1) * itemsPerPage;
        const paginated = filteredProducts.slice(start, start + itemsPerPage);
        const tbody = document.getElementById('inventory-table');

        if (paginated.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-box-open"></i><p>${products.length === 0 ? 'No products yet. Add your first product!' : 'No products match your search.'}</p></div></td></tr>`;
        } else {
            tbody.innerHTML = paginated.map((p, idx) => {
                const statusClass = p.status === 'in-stock' ? 'status-in-stock' : p.status === 'low' ? 'status-low' : 'status-out';
                const statusText = p.status === 'in-stock' ? 'In Stock' : p.status === 'low' ? 'Low Stock' : 'Out of Stock';
                const stockBar = (p.quantity||0) > 50 ? 'bg-emerald-500' : (p.quantity||0) > 10 ? 'bg-amber-500' : 'bg-red-500';
                const maxQ = Math.max(...products.map(x => x.quantity||0), 1);
                const stockWidth = Math.min(((p.quantity||0) / maxQ) * 100, 100);
                const desc = p.description || '';
                // FIX #2: Use formatPrice() instead of hardcoded '$'
                return `
                <tr class="hover:bg-gray-50 transition-colors table-row-anim" style="animation-delay:${idx*0.05}s">
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center text-gray-500 shadow-sm"><i class="fas fa-box text-sm"></i></div>
                            <div>
                                <p class="font-medium text-gray-800 text-sm">${p.name}</p>
                                <p class="text-xs text-gray-400">${desc.length > 35 ? desc.substring(0,35)+'...' : desc || '—'}</p>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-500 font-mono">${p.sku}</td>
                    <td class="px-6 py-4"><span class="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md text-xs font-medium">${p.category}</span></td>
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <span class="text-sm font-bold text-gray-800 w-8">${p.quantity}</span>
                            <div class="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div class="${stockBar} h-full rounded-full transition-all duration-500" style="width:${stockWidth}%"></div></div>
                        </div>
                    </td>
                    <td class="px-6 py-4"><span class="status-badge ${statusClass}"><span class="w-1.5 h-1.5 rounded-full bg-current mr-1.5"></span>${statusText}</span></td>
                    <td class="px-6 py-4 text-sm text-gray-600">${formatPrice(p.buyPrice ?? p.price ?? 0)}</td>
                    <td class="px-6 py-4 text-sm font-bold text-gray-800">${formatPrice(p.sellPrice ?? p.price ?? 0)}</td>
                    <td class="px-6 py-4">${(() => {
                        const buy = p.buyPrice ?? p.price ?? 0;
                        const sell = p.sellPrice ?? p.price ?? 0;
                        const m = buy > 0 ? Math.round(((sell - buy) / buy) * 100) : 0;
                        const cls = m >= 30 ? 'text-emerald-600' : m >= 10 ? 'text-amber-600' : 'text-red-500';
                        return `<span class="text-sm font-bold ${cls}">${m}%</span>`;
                    })()}</td>
                    <td class="px-6 py-4 text-right">
                        <div class="flex items-center justify-end gap-1">
                            <button onclick="editProduct('${p.id}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><i class="fas fa-pen-to-square text-sm"></i></button>
                            <button onclick="deleteProduct('${p.id}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><i class="fas fa-trash text-sm"></i></button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }
        document.getElementById('showing-count').textContent = paginated.length;
        document.getElementById('total-count').textContent = filteredProducts.length;
        document.getElementById('prev-btn').disabled = currentPage === 1;
        document.getElementById('next-btn').disabled = start + itemsPerPage >= filteredProducts.length;
    }

    function getFilteredProducts() {
        const search = document.getElementById('inventory-search')?.value.toLowerCase() || '';
        const category = document.getElementById('category-filter')?.value || '';
        const status = document.getElementById('status-filter')?.value || '';
        return products.filter(p => {
            const matchSearch = (p.name||'').toLowerCase().includes(search) || (p.sku||'').toLowerCase().includes(search);
            const matchCat = !category || p.category === category;
            const matchStatus = !status || p.status === status;
            return matchSearch && matchCat && matchStatus;
        });
    }

    function filterInventory() { currentPage = 1; renderInventory(); }
    function sortTable(field) {
        if (currentSort.field === field) currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        else { currentSort.field = field; currentSort.dir = 'asc'; }
        renderInventory();
    }
    function changePage(dir) { currentPage += dir; renderInventory(); }

    // ==================== CATEGORIES ====================
    const catColors = ['bg-blue-500','bg-purple-500','bg-amber-500','bg-emerald-500','bg-rose-500','bg-cyan-500','bg-orange-500','bg-teal-500'];

    function renderCategories() {
        const grid = document.getElementById('categories-grid');
        if (!categories.length) {
            grid.innerHTML = '<div class="col-span-3"><div class="empty-state bg-white rounded-2xl border border-gray-100 shadow-sm"><i class="fas fa-tags"></i><p>No categories yet. Add one!</p></div></div>';
            document.getElementById('categories-table').innerHTML = '';
            return;
        }
        grid.innerHTML = categories.map((c, i) => {
            const catProducts = products.filter(p => p.category === c.name);
            const totalVal = catProducts.reduce((a, p) => a + ((p.price||0) * (p.quantity||0)), 0);
            const avgPrice = catProducts.length ? (catProducts.reduce((a, p) => a + (p.price||0), 0) / catProducts.length) : 0;
            const color = catColors[i % catColors.length];
            const icon = c.icon || 'fa-box';
            // FIX #2: formatPrice() used here
            return `
            <div class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 card-hover">
                <div class="flex items-center justify-between mb-4">
                    <div class="w-12 h-12 ${color} rounded-xl flex items-center justify-center text-white shadow-lg"><i class="fas ${icon} text-xl"></i></div>
                    <div class="text-right"><span class="text-2xl font-bold text-gray-800">${catProducts.length}</span><p class="text-xs text-gray-500">products</p></div>
                </div>
                <h3 class="font-semibold text-gray-800 text-lg">${c.name}</h3>
                <p class="text-sm text-gray-500 mt-1">${c.description || '—'}</p>
                <div class="mt-4 pt-4 border-t border-gray-100 flex justify-between text-sm">
                    <span class="text-gray-500">Value: <span class="font-semibold text-gray-700">${formatPrice(totalVal)}</span></span>
                    <span class="text-gray-500">Avg: <span class="font-semibold text-gray-700">${formatPrice(avgPrice)}</span></span>
                </div>
                <button onclick="deleteCategory('${c.id}','${c.name}')" class="mt-3 text-xs text-red-500 hover:text-red-700 mr-3">Delete</button>
                <button onclick="editCategory('${c.id}')" class="mt-3 text-xs text-blue-500 hover:text-blue-700"><i class="fas fa-pen mr-1"></i>Edit</button>
            </div>`;
        }).join('');

        document.getElementById('categories-table').innerHTML = categories.map((c, i) => {
            const catProducts = products.filter(p => p.category === c.name);
            const totalVal = catProducts.reduce((a, p) => a + ((p.price||0) * (p.quantity||0)), 0);
            const avgPrice = catProducts.length ? (catProducts.reduce((a, p) => a + (p.price||0), 0) / catProducts.length) : 0;
            const color = catColors[i % catColors.length];
            return `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4"><div class="flex items-center gap-3"><div class="w-8 h-8 ${color} rounded-lg flex items-center justify-center text-white"><i class="fas ${c.icon||'fa-box'} text-xs"></i></div><span class="font-medium text-gray-800 text-sm">${c.name}</span></div></td>
                <td class="px-6 py-4 text-sm font-semibold text-gray-800">${catProducts.length}</td>
                <td class="px-6 py-4 text-sm font-semibold text-gray-800">${formatPrice(totalVal)}</td>
                <td class="px-6 py-4 text-sm text-gray-600">${formatPrice(avgPrice)}</td>
                <td class="px-6 py-4 text-right">
                    <button onclick="editCategory('${c.id}')" class="text-sm text-blue-500 hover:text-blue-700 font-medium mr-3"><i class="fas fa-pen"></i></button>
                    <button onclick="deleteCategory('${c.id}','${c.name}')" class="text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>
                </td>
            </tr>`;
        }).join('');

        const sel = document.getElementById('category-filter');
        if (sel) {
            const cur = sel.value;
            sel.innerHTML = '<option value="">All Categories</option>' + categories.map(c => `<option value="${c.name}" ${c.name===cur?'selected':''}>${c.name}</option>`).join('');
        }
    }

    // ==================== SUPPLIERS ====================
    function renderSuppliers() {
        const cards = document.getElementById('suppliers-cards');
        const tbody = document.getElementById('suppliers-table');
        if (!suppliers.length) {
            cards.innerHTML = '<div class="col-span-4"><div class="empty-state bg-white rounded-xl border border-gray-100 shadow-sm"><i class="fas fa-truck"></i><p>No suppliers yet</p></div></div>';
            tbody.innerHTML = '';
            return;
        }
        cards.innerHTML = suppliers.map(s => `
            <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-100 card-hover">
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 font-bold text-sm">${(s.name||'?').substring(0,2).toUpperCase()}</div>
                    <div class="flex-1 min-w-0"><p class="font-semibold text-gray-800 text-sm truncate">${s.name}</p><p class="text-xs text-gray-500">${s.contact||''}</p></div>
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium ${s.status==='active'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-600'}">${s.status}</span>
                </div>
                <div class="flex items-center justify-between text-xs text-gray-500">
                    <span><i class="fas fa-box mr-1"></i>${products.filter(p=>p.supplier===s.name).length} products</span>
                    <span class="text-amber-500"><i class="fas fa-star mr-1"></i>${s.rating||'—'}</span>
                </div>
            </div>`).join('');

        tbody.innerHTML = suppliers.map(s => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4"><div class="flex items-center gap-3"><div class="w-10 h-10 bg-gradient-to-br from-primary-100 to-primary-200 rounded-lg flex items-center justify-center text-primary-700 font-bold text-sm">${(s.name||'?').substring(0,2).toUpperCase()}</div><div><p class="font-medium text-gray-800 text-sm">${s.name}</p><p class="text-xs text-gray-400">${(s.address||'').substring(0,30)}${(s.address||'').length>30?'...':''}</p></div></div></td>
                <td class="px-6 py-4 text-sm text-gray-600"><p class="font-medium">${s.contact||''}</p><p class="text-xs text-gray-400">${s.email||''}</p></td>
                <td class="px-6 py-4 text-sm font-semibold text-gray-800">${products.filter(p=>p.supplier===s.name).length}</td>
                <td class="px-6 py-4"><div class="flex items-center gap-1">${Array(5).fill(0).map((_,i)=>`<i class="fas fa-star text-xs ${i<Math.floor(s.rating||0)?'text-amber-400':'text-gray-200'}"></i>`).join('')}<span class="text-sm font-semibold text-gray-700 ml-1">${s.rating||'—'}</span></div></td>
                <td class="px-6 py-4"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${s.status==='active'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-600'} capitalize">${s.status}</span></td>
                <td class="px-6 py-4 text-right">
                    <button onclick="editSupplier('${s.id}')" class="text-sm text-blue-500 hover:text-blue-700 font-medium mr-3"><i class="fas fa-pen"></i></button>
                    <button onclick="deleteSupplier('${s.id}')" class="text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>
                </td>
            </tr>`).join('');
    }

    // ==================== ORDERS ====================
    function renderOrders() {
        const filtered = getFilteredOrders();
        document.getElementById('order-total').textContent = orders.length;
        document.getElementById('order-pending').textContent = orders.filter(o=>o.status==='pending').length;
        document.getElementById('order-processing').textContent = orders.filter(o=>o.status==='processing').length;
        document.getElementById('order-completed').textContent = orders.filter(o=>o.status==='completed').length;
        const tbody = document.getElementById('orders-table');
        const statusClasses = { completed:'status-completed', pending:'status-pending', processing:'status-processing', cancelled:'status-cancelled' };
        if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-clipboard-list"></i><p>No orders yet</p></div></td></tr>'; return; }
        // FIX #2: formatPrice() used here
        tbody.innerHTML = filtered.map(o => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 font-mono text-sm font-bold text-gray-800">${o.orderId||o.id.substring(0,8).toUpperCase()}</td>
                <td class="px-6 py-4 text-sm text-gray-700 font-medium">${o.supplier}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${o.date||''}</td>
                <td class="px-6 py-4 text-sm font-semibold text-gray-800">${o.items} items</td>
                <td class="px-6 py-4 text-sm font-bold text-gray-800">${formatPrice(o.total)}</td>
                <td class="px-6 py-4">
                    <select onchange="updateOrderStatus('${o.id}',this.value)" class="text-xs px-2 py-1 rounded-full border-0 font-semibold cursor-pointer ${statusClasses[o.status]||''}">
                        ${['pending','processing','completed','cancelled'].map(s=>`<option value="${s}" ${s===o.status?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
                    </select>
                </td>
                <td class="px-6 py-4 text-right"><button onclick="deleteOrder('${o.id}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><i class="fas fa-trash text-sm"></i></button></td>
            </tr>`).join('');
    }

    function getFilteredOrders() {
        const search = document.getElementById('order-search')?.value.toLowerCase() || '';
        const status = document.getElementById('order-status-filter')?.value || '';
        return orders.filter(o => {
            const matchSearch = (o.orderId||o.id||'').toLowerCase().includes(search) || (o.supplier||'').toLowerCase().includes(search);
            const matchStatus = !status || o.status === status;
            return matchSearch && matchStatus;
        });
    }

    function filterOrders() { renderOrders(); }

    async function updateOrderStatus(id, status) {
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('orders').doc(id).update({ status });
            showToast('Order status updated', 'success');
        } catch (e) { showToast('Failed to update order', 'error'); }
    }

    // ==================== USERS ====================
    function renderUsers() {
        const tbody = document.getElementById('users-table');
        if (!users_list.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="fas fa-users"></i><p>No users</p></div></td></tr>'; return; }
        tbody.innerHTML = users_list.map(u => {
            const name = u.name || u.email;
            const avatarUrl = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff&size=128`;
            const provider = u.provider === 'google.com' ? '<i class="fab fa-google text-red-500 mr-1"></i>Google' : '<i class="fas fa-envelope text-gray-400 mr-1"></i>Email';
            const lastActive = u.lastActive?.toDate ? timeAgo(u.lastActive.toDate()) : '—';
            const isCurrentUser = u.id === currentUser.uid;
            return `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4"><div class="flex items-center gap-3"><img src="${avatarUrl}" class="w-9 h-9 rounded-full" alt="${name}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff&size=128'"><div><p class="font-medium text-gray-800 text-sm">${name} ${isCurrentUser?'<span class="text-xs text-blue-500">(you)</span>':''}</p><p class="text-xs text-gray-400">${u.email}</p></div></div></td>
                <td class="px-6 py-4 text-sm text-gray-600">${provider}</td>
                <td class="px-6 py-4"><span class="px-2.5 py-1 bg-primary-50 text-primary-700 rounded-md text-xs font-medium">${u.role||'User'}</span></td>
                <td class="px-6 py-4 text-sm text-gray-500">${lastActive}</td>
                <td class="px-6 py-4 text-right">${!isCurrentUser?`<button onclick="removeUser('${u.id}')" class="text-sm text-red-500 hover:text-red-700 font-medium">Remove</button>`:'<span class="text-xs text-gray-400">—</span>'}</td>
            </tr>`;
        }).join('');
    }

    // ==================== REPORTS ====================
    function renderCharts() {
        const catContainer = document.getElementById('category-chart-container');
        if (!categories.length || !products.length) {
            catContainer.innerHTML = '<div class="empty-state"><i class="fas fa-chart-pie"></i><p>No data yet</p></div>';
        } else {
            const total = products.length;
            let currentAngle = -90;
            const colors = ['#3b82f6','#a855f7','#f59e0b','#10b981','#f43f5e','#06b6d4'];
            let svgContent = '', legendContent = '';
            categories.forEach((c, i) => {
                const count = products.filter(p => p.category === c.name).length;
                if (!count) return;
                const pct = count / total;
                const angle = pct * 360;
                const rad1 = (currentAngle * Math.PI) / 180;
                const rad2 = ((currentAngle + angle) * Math.PI) / 180;
                const x1 = 50 + 40 * Math.cos(rad1), y1 = 50 + 40 * Math.sin(rad1);
                const x2 = 50 + 40 * Math.cos(rad2), y2 = 50 + 40 * Math.sin(rad2);
                const largeArc = angle > 180 ? 1 : 0;
                svgContent += `<path d="M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${colors[i%colors.length]}" stroke="white" stroke-width="2" opacity="0.9"/>`;
                legendContent += `<div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full" style="background:${colors[i%colors.length]}"></span><span class="text-sm text-gray-600">${c.name}</span><span class="text-sm font-bold text-gray-800 ml-2">${Math.round(pct*100)}%</span></div>`;
                currentAngle += angle;
            });
            catContainer.innerHTML = `<svg width="180" height="180" viewBox="0 0 100 100">${svgContent}</svg><div class="space-y-2">${legendContent}</div>`;
        }

        const alerts = products.filter(p => p.status !== 'in-stock');
        const alertsEl = document.getElementById('stock-alerts');
        if (!alerts.length) {
            alertsEl.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle text-emerald-400"></i><p>All stock levels healthy!</p></div>';
        } else {
            alertsEl.innerHTML = alerts.map(p => `
                <div class="flex items-center gap-3 p-3 rounded-lg ${p.status==='low'?'bg-amber-50 border border-amber-100':'bg-red-50 border border-red-100'}">
                    <i class="fas ${p.status==='low'?'fa-triangle-exclamation text-amber-500':'fa-circle-xmark text-red-500'}"></i>
                    <div class="flex-1"><p class="text-sm font-medium text-gray-800">${p.name}</p><p class="text-xs ${p.status==='low'?'text-amber-600':'text-red-600'}">${p.quantity} units remaining</p></div>
                    <button onclick="showSection('inventory');setTimeout(()=>editProduct('${p.id}'),400)" class="text-xs font-medium text-primary-600 hover:text-primary-700">Restock</button>
                </div>`).join('');
        }

        // FIX #2: formatPrice() in summary table
        const totalVal = products.reduce((a, p) => a + ((p.price||0) * (p.quantity||0)), 0);
        const summaryData = [
            ['Total Products', products.length],
            ['Total Categories', categories.length],
            ['Total Suppliers', suppliers.length],
            ['Total Orders', orders.length],
            ['Inventory Value', formatPrice(totalVal)],
            ['Out of Stock', products.filter(p=>p.status==='out').length],
            ['Low Stock', products.filter(p=>p.status==='low').length],
            ['Completed Orders', orders.filter(o=>o.status==='completed').length],
            ['Currency', `${currentCurrency} (${getCurrencySymbol()})`]
        ];
        document.getElementById('summary-table').innerHTML = summaryData.map(([k,v]) => `
            <tr class="hover:bg-gray-50"><td class="px-4 py-3 font-medium">${k}</td><td class="px-4 py-3 text-right font-semibold">${v}</td></tr>`).join('');
    }

    // ==================== STATS ====================
    function updateStats() {
        const total = products.length;
        const low = products.filter(p=>p.status==='low').length;
        const out = products.filter(p=>p.status==='out').length;
        const inStock = products.filter(p=>p.status==='in-stock').length;
        const value = products.reduce((a,p) => a + ((p.price||0)*(p.quantity||0)), 0);
        const thisMonth = orders.filter(o => {
            if (!o.date) return false;
            const now = new Date(), d = new Date(o.date);
            return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
        }).length;

        document.getElementById('total-products').textContent = total.toLocaleString();
        document.getElementById('low-stock-count').textContent = low;
        // FIX #2: compact formatPrice for the stat card
        document.getElementById('inventory-value').textContent = formatPrice(value, true);
        document.getElementById('monthly-orders').textContent = thisMonth;
        document.getElementById('health-in').textContent = inStock;
        document.getElementById('health-low').textContent = low;
        document.getElementById('health-out').textContent = out;

        // Today's sales & purchases
        const today = new Date().toISOString().split('T')[0];
        const todaySalesTotal = sales_list.filter(s => s.date === today).reduce((a, s) => a + (s.revenue || 0), 0);
        const todayPurchasesTotal = purchases.filter(p => p.date === today).reduce((a, p) => a + (p.total || 0), 0);
        const todSalesEl = document.getElementById('today-sales');
        const todPurchEl = document.getElementById('today-purchases');
        if (todSalesEl) todSalesEl.textContent = formatPrice(todaySalesTotal, true);
        if (todPurchEl) todPurchEl.textContent = formatPrice(todayPurchasesTotal, true);

        // Profit / Loss banner
        const todaySales   = sales_list.filter(s => s.date === today);
        const todayRev     = todaySales.reduce((a, s) => a + (s.revenue || 0), 0);
        const todayCost    = todaySales.reduce((a, s) => a + (s.cost || 0), 0);
        const todayProfit  = todayRev - todayCost;
        const banner       = document.getElementById('profit-banner');
        const icon         = document.getElementById('profit-icon');
        const bannerLabel  = document.getElementById('profit-banner-label');
        const bannerValue  = document.getElementById('profit-banner-value');
        const bannerSub    = document.getElementById('profit-banner-sub');
        const revDisplay   = document.getElementById('profit-rev-display');
        const costDisplay  = document.getElementById('profit-cost-display');
        if (banner && icon) {
            if (todaySales.length === 0) {
                banner.className = 'rounded-2xl border-2 p-5 mb-6 flex items-center justify-between transition-all duration-500 bg-gray-50 border-gray-200';
                icon.className   = 'w-14 h-14 rounded-2xl flex items-center justify-center text-2xl bg-gray-200 text-gray-500 flex-shrink-0';
                icon.innerHTML   = '<i class="fas fa-store"></i>';
                bannerLabel.textContent = "Today's Profit";
                bannerValue.textContent = formatPrice(0, true);
                bannerSub.textContent   = 'No sales recorded today';
                if (revDisplay)  revDisplay.textContent  = '—';
                if (costDisplay) costDisplay.textContent = '—';
            } else if (todayProfit >= 0) {
                banner.className = 'rounded-2xl border-2 p-5 mb-6 flex items-center justify-between transition-all duration-500 profit-green';
                icon.className   = 'w-14 h-14 rounded-2xl flex items-center justify-center text-2xl bg-emerald-400 text-white flex-shrink-0';
                icon.innerHTML   = '<i class="fas fa-arrow-trend-up"></i>';
                bannerLabel.textContent = "✅ Today's Profit";
                bannerValue.textContent = formatPrice(todayProfit, true);
                bannerSub.textContent   = `${todaySales.length} sale${todaySales.length > 1 ? 's' : ''} · margin ${todayRev > 0 ? Math.round((todayProfit / todayRev) * 100) : 0}%`;
                if (revDisplay)  revDisplay.textContent  = 'Revenue: ' + formatPrice(todayRev, true);
                if (costDisplay) costDisplay.textContent = 'Cost: '    + formatPrice(todayCost, true);
            } else {
                banner.className = 'rounded-2xl border-2 p-5 mb-6 flex items-center justify-between transition-all duration-500 profit-red';
                icon.className   = 'w-14 h-14 rounded-2xl flex items-center justify-center text-2xl bg-red-400 text-white flex-shrink-0';
                icon.innerHTML   = '<i class="fas fa-arrow-trend-down"></i>';
                bannerLabel.textContent = "⚠️ Today's Loss";
                bannerValue.textContent = formatPrice(Math.abs(todayProfit), true);
                bannerSub.textContent   = `Selling below cost · ${todaySales.length} sale${todaySales.length > 1 ? 's' : ''}`;
                if (revDisplay)  revDisplay.textContent  = 'Revenue: ' + formatPrice(todayRev, true);
                if (costDisplay) costDisplay.textContent = 'Cost: '    + formatPrice(todayCost, true);
            }
        }

        const hp = total > 0 ? Math.round((inStock / total) * 100) : 0;
        document.getElementById('health-percent').textContent = hp + '%';
        document.getElementById('health-ring').style.strokeDashoffset = 251.2 - (251.2 * hp / 100);
        document.getElementById('notif-dot').classList.toggle('hidden', low + out === 0);
    }

    // ==================== DROPDOWNS ====================
    function populateProductDropdowns() {
        const catSel = document.getElementById('product-category');
        const supSel = document.getElementById('product-supplier');
        if (catSel) catSel.innerHTML = '<option value="">— Select Category —</option>' + categories.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
        if (supSel) supSel.innerHTML = '<option value="">— Select Supplier —</option>' + suppliers.map(s=>`<option value="${s.name}">${s.name}</option>`).join('');
    }

    // ==================== PRODUCT CRUD ====================
    function updateModalMargin() {
        const buy  = parseFloat(document.getElementById('product-buy-price').value) || 0;
        const sell = parseFloat(document.getElementById('product-sell-price').value) || 0;
        const prev = document.getElementById('margin-preview');
        const val  = document.getElementById('margin-preview-value');
        if (buy > 0 && sell > 0) {
            const m = Math.round(((sell - buy) / buy) * 100);
            prev.classList.remove('hidden');
            prev.className = `rounded-lg px-4 py-2.5 flex items-center justify-between text-sm border ${m >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`;
            val.textContent = m + '% ' + (m >= 0 ? '✓' : '⚠ selling below cost');
            val.className   = `font-bold ${m >= 0 ? 'text-emerald-700' : 'text-red-600'}`;
        } else {
            prev.classList.add('hidden');
        }
    }

    function openAddModal() {
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        document.getElementById('modal-title').textContent = 'Add New Product';
        document.getElementById('margin-preview').classList.add('hidden');
        populateProductDropdowns();
        document.getElementById('product-modal').classList.remove('hidden');
    }

    function editProduct(id) {
        const p = products.find(x => x.id === id);
        if (!p) return;
        populateProductDropdowns();
        document.getElementById('product-id').value = p.id;
        document.getElementById('product-name').value = p.name;
        document.getElementById('product-sku').value = p.sku;
        document.getElementById('product-category').value = p.category;
        document.getElementById('product-quantity').value = p.quantity;
        document.getElementById('product-min-stock').value = p.minStock || lowStockThreshold;
        document.getElementById('product-buy-price').value = p.buyPrice ?? p.price ?? '';
        document.getElementById('product-sell-price').value = p.sellPrice ?? p.price ?? '';
        document.getElementById('product-supplier').value = p.supplier || '';
        document.getElementById('product-description').value = p.description || '';
        document.getElementById('modal-title').textContent = 'Edit Product';
        updateModalMargin();
        document.getElementById('product-modal').classList.remove('hidden');
    }

    async function saveProduct(e) {
        e.preventDefault();
        const btn = document.getElementById('product-save-btn');
        setLoading(btn, true);
        const id = document.getElementById('product-id').value;
        const quantity = parseInt(document.getElementById('product-quantity').value);
        const minStock = parseInt(document.getElementById('product-min-stock').value) || lowStockThreshold;
        let status = 'in-stock';
        if (quantity === 0) status = 'out';
        else if (quantity < minStock) status = 'low';

        const buyPrice  = parseFloat(document.getElementById('product-buy-price').value) || 0;
        const sellPrice = parseFloat(document.getElementById('product-sell-price').value) || 0;

        const product = {
            name: document.getElementById('product-name').value,
            sku: document.getElementById('product-sku').value,
            category: document.getElementById('product-category').value,
            quantity,
            minStock,
            buyPrice,
            sellPrice,
            price: sellPrice, // keep for backward compat with existing queries
            supplier: document.getElementById('product-supplier').value,
            description: document.getElementById('product-description').value,
            status,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            const col = db.collection('workspaces').doc(currentUser.uid).collection('products');
            if (id) {
                await col.doc(id).update(product);
                showToast('Product updated!', 'success');
                logActivity('Product updated', product.name, 'fa-pen', 'text-blue-500', 'bg-blue-50');
            } else {
                product.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await col.add(product);
                showToast('Product added!', 'success');
                logActivity('Product added', product.name, 'fa-plus', 'text-emerald-500', 'bg-emerald-50');
            }
            closeModal('product-modal');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
        setLoading(btn, false);
    }

    async function deleteProduct(id) {
        const p = products.find(x => x.id === id);
        if (!confirm(`Delete "${p?.name}"? This cannot be undone.`)) return;
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('products').doc(id).delete();
            logActivity('Product deleted', p?.name||id, 'fa-trash', 'text-red-500', 'bg-red-50');
            showToast('Product deleted', 'info');
        } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
    }

    // ==================== CATEGORY CRUD ====================
    function openCategoryModal() {
        document.getElementById('edit-category-id').value = '';
        document.getElementById('new-category-name').value = '';
        document.getElementById('new-category-icon').value = '';
        document.getElementById('new-category-desc').value = '';
        document.getElementById('cat-modal-title').textContent = 'Add New Category';
        document.getElementById('cat-save-btn').textContent = 'Add Category';
        document.getElementById('category-modal').classList.remove('hidden');
    }

    function editCategory(id) {
        const c = categories.find(x => x.id === id);
        if (!c) return;
        document.getElementById('edit-category-id').value = c.id;
        document.getElementById('new-category-name').value = c.name;
        document.getElementById('new-category-icon').value = c.icon || '';
        document.getElementById('new-category-desc').value = c.description || '';
        document.getElementById('cat-modal-title').textContent = 'Edit Category';
        document.getElementById('cat-save-btn').textContent = 'Save Changes';
        document.getElementById('category-modal').classList.remove('hidden');
    }

    async function saveCategory(e) {
        e.preventDefault();
        const btn = document.getElementById('cat-save-btn');
        setLoading(btn, true);
        const id = document.getElementById('edit-category-id').value;
        const data = {
            name: document.getElementById('new-category-name').value,
            icon: document.getElementById('new-category-icon').value || 'fa-box',
            description: document.getElementById('new-category-desc').value,
        };
        try {
            const col = db.collection('workspaces').doc(currentUser.uid).collection('categories');
            if (id) {
                await col.doc(id).update(data);
                showToast('Category updated!', 'success');
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await col.add(data);
                showToast('Category added!', 'success');
            }
            closeModal('category-modal');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
        setLoading(btn, false);
    }

    async function deleteCategory(id, name) {
        if (products.some(p => p.category === name)) { showToast(`Can't delete "${name}" — it has products. Reassign them first.`, 'warning'); return; }
        if (!confirm(`Delete category "${name}"?`)) return;
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('categories').doc(id).delete();
            showToast('Category deleted', 'info');
        } catch (e) { showToast('Delete failed', 'error'); }
    }

    // ==================== SUPPLIER CRUD ====================
    function openSupplierModal() {
        document.getElementById('edit-supplier-id').value = '';
        document.getElementById('supplier-modal').querySelector('form').reset();
        document.getElementById('sup-modal-title').textContent = 'Add New Supplier';
        document.getElementById('sup-save-btn').textContent = 'Add Supplier';
        document.getElementById('supplier-modal').classList.remove('hidden');
    }

    function editSupplier(id) {
        const s = suppliers.find(x => x.id === id);
        if (!s) return;
        document.getElementById('edit-supplier-id').value = s.id;
        document.getElementById('new-supplier-name').value = s.name || '';
        document.getElementById('new-supplier-contact').value = s.contact || '';
        document.getElementById('new-supplier-email').value = s.email || '';
        document.getElementById('new-supplier-phone').value = s.phone || '';
        document.getElementById('new-supplier-gst').value = s.gst || '';
        document.getElementById('new-supplier-status').value = s.status || 'active';
        document.getElementById('new-supplier-address').value = s.address || '';
        document.getElementById('sup-modal-title').textContent = 'Edit Supplier';
        document.getElementById('sup-save-btn').textContent = 'Save Changes';
        document.getElementById('supplier-modal').classList.remove('hidden');
    }

    async function saveSupplier(e) {
        e.preventDefault();
        const btn = document.getElementById('sup-save-btn');
        setLoading(btn, true);
        const id = document.getElementById('edit-supplier-id').value;
        const name = document.getElementById('new-supplier-name').value;
        const data = {
            name, contact: document.getElementById('new-supplier-contact').value,
            email: document.getElementById('new-supplier-email').value,
            phone: document.getElementById('new-supplier-phone').value,
            gst: document.getElementById('new-supplier-gst').value,
            status: document.getElementById('new-supplier-status').value,
            address: document.getElementById('new-supplier-address').value,
        };
        try {
            const col = db.collection('workspaces').doc(currentUser.uid).collection('suppliers');
            if (id) {
                await col.doc(id).update(data);
                showToast('Supplier updated!', 'success');
                logActivity('Supplier updated', name, 'fa-truck', 'text-purple-500', 'bg-purple-50');
            } else {
                data.rating = 0;
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await col.add(data);
                showToast('Supplier added!', 'success');
                logActivity('Supplier added', name, 'fa-truck', 'text-purple-500', 'bg-purple-50');
            }
            closeModal('supplier-modal');
            document.getElementById('supplier-modal').querySelector('form').reset();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
        setLoading(btn, false);
    }

    async function deleteSupplier(id) {
        if (!confirm('Delete this supplier?')) return;
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('suppliers').doc(id).delete();
            showToast('Supplier deleted', 'info');
        } catch (e) { showToast('Delete failed', 'error'); }
    }

    // ==================== ORDER CRUD ====================
    function openOrderModal() {
        document.getElementById('order-supplier').innerHTML = '<option value="">— Select Supplier —</option>' + suppliers.map(s=>`<option value="${s.name}">${s.name}</option>`).join('');
        document.getElementById('order-items-container').innerHTML = '';
        document.getElementById('order-total-display').textContent = formatPrice(0);
        addOrderItem();
        document.getElementById('order-modal').classList.remove('hidden');
    }

    function addOrderItem() {
        const container = document.getElementById('order-items-container');
        const div = document.createElement('div');
        div.className = 'flex gap-2 items-end';
        div.innerHTML = `
            <div class="flex-1"><label class="block text-sm font-medium text-gray-700 mb-1">Product</label>
            <select class="order-product w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" onchange="updateOrderTotal()">
                <option value="">Select product</option>
                ${products.map(p=>`<option value="${p.id}" data-price="${p.price}">${p.name} — ${formatPrice(p.price)}</option>`).join('')}
            </select></div>
            <div class="w-24"><label class="block text-sm font-medium text-gray-700 mb-1">Qty</label>
            <input type="number" class="order-qty w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" min="1" value="1" onchange="updateOrderTotal()"></div>
            <button type="button" onclick="removeOrderItem(this)" class="p-2 text-red-500 hover:bg-red-50 rounded-lg mb-0.5"><i class="fas fa-trash"></i></button>`;
        container.appendChild(div);
    }

    function removeOrderItem(btn) {
        const items = document.querySelectorAll('#order-items-container > div');
        if (items.length > 1) { btn.closest('div').remove(); updateOrderTotal(); }
    }

    function updateOrderTotal() {
        let total = 0;
        document.querySelectorAll('#order-items-container > div').forEach(row => {
            const sel = row.querySelector('.order-product');
            const qty = parseInt(row.querySelector('.order-qty')?.value) || 0;
            const price = parseFloat(sel?.selectedOptions[0]?.dataset?.price) || 0;
            total += price * qty;
        });
        document.getElementById('order-total-display').textContent = formatPrice(total);
    }

    async function saveOrder(e) {
        e.preventDefault();
        const btn = document.getElementById('order-save-btn');
        setLoading(btn, true);
        const supplier = document.getElementById('order-supplier').value;
        const totalText = document.getElementById('order-total-display').textContent;
        // Strip currency symbol to parse number
        const total = parseFloat(totalText.replace(/[^0-9.]/g, '')) || 0;
        const items = document.querySelectorAll('#order-items-container > div').length;
        const orderId = 'PO-' + Date.now().toString(36).toUpperCase();
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('orders').add({
                orderId, supplier, items, total, status: 'pending',
                date: new Date().toISOString().split('T')[0],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            logActivity('Order created', orderId, 'fa-cart-plus', 'text-emerald-500', 'bg-emerald-50');
            closeModal('order-modal');
            showToast('Order created!', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
        setLoading(btn, false);
    }

    async function deleteOrder(id) {
        if (!confirm('Delete this order?')) return;
        try {
            await db.collection('workspaces').doc(currentUser.uid).collection('orders').doc(id).delete();
            showToast('Order deleted', 'info');
        } catch (e) { showToast('Delete failed', 'error'); }
    }

    // ==================== USERS ====================
    async function removeUser(uid) {
        if (!confirm('Remove this user record?')) return;
        try {
            await db.collection('users').doc(uid).delete();
            showToast('User removed', 'info');
        } catch (e) { showToast('Failed: ' + e.message, 'error'); }
    }

    // ==================== EXPORT ====================
    function exportData() {
        if (!products.length) { showToast('No products to export', 'warning'); return; }
        const sym = getCurrencySymbol();
        const csv = [
            ['Name','SKU','Category','Quantity',`Price (${sym})`,`Total Value (${sym})`,'Status','Supplier','Description'].join(','),
            ...products.map(p => [
                `"${p.name}"`,`"${p.sku}"`,`"${p.category}"`,
                p.quantity, p.price, (p.price*p.quantity).toFixed(2),
                p.status,`"${p.supplier||''}"`,`"${(p.description||'').replace(/"/g,"'")}"`
            ].join(','))
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inventory_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported successfully!', 'success');
    }

    // ==================== UTILITIES ====================
    function showToast(message, type='info') {
        const container = document.getElementById('toast-container');
        const colors = { success:'bg-emerald-500', error:'bg-red-500', info:'bg-primary-500', warning:'bg-amber-500' };
        const icons = { success:'fa-check-circle', error:'fa-xmark-circle', info:'fa-info-circle', warning:'fa-triangle-exclamation' };
        const toast = document.createElement('div');
        toast.className = `toast ${colors[type]} text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 min-w-[280px] max-w-xs`;
        toast.innerHTML = `<i class="fas ${icons[type]}"></i><span class="font-medium text-sm">${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function setLoading(btn, loading, originalText) {
        if (loading) { btn._orig = originalText || btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true; }
        else { btn.innerHTML = btn._orig || originalText || 'Submit'; btn.disabled = false; }
    }

    function togglePassword(inputId, iconId) {
        const input = document.getElementById(inputId);
        const icon = document.getElementById(iconId);
        if (input.type === 'password') { input.type = 'text'; icon.classList.replace('fa-eye','fa-eye-slash'); }
        else { input.type = 'password'; icon.classList.replace('fa-eye-slash','fa-eye'); }
    }

    function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

    function globalSearch(query) {
        if (!query.trim()) return;
        showSection('inventory');
        document.getElementById('inventory-search').value = query;
        filterInventory();
    }

    function showNotifications() {
        const low = products.filter(p => p.status !== 'in-stock');
        if (!low.length) showToast('All stock levels are healthy!', 'success');
        else showToast(`${low.length} item(s) need attention (low/out of stock)`, 'warning');
    }

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) document.getElementById('sidebar').classList.remove('-translate-x-full');
    });

    // ==================== BOOT ====================
    // Wait for all scripts (Firebase SDKs) to fully load before booting
    // Use window.onload to ensure Firebase SDKs are fully parsed and ready
    // ==================== PURCHASES ====================
    let purchases = [], sales_list = [], adjustments_list = [];

    function openPurchaseModal() {
        document.getElementById('purchase-product').innerHTML = '<option value="">— Select Product —</option>' + products.map(p=>`<option value="${p.id}" data-price="${p.buyPrice ?? p.price ?? 0}" data-qty="${p.quantity}">${p.name} (Stock: ${p.quantity})</option>`).join('');
        document.getElementById('purchase-supplier').innerHTML = '<option value="">— Select Supplier —</option>' + suppliers.map(s=>`<option value="${s.name}">${s.name}</option>`).join('');
        document.getElementById('purchase-modal').querySelector('form').reset();
        document.getElementById('purchase-modal').classList.remove('hidden');
    }

    async function savePurchase(e) {
        e.preventDefault();
        const btn = document.getElementById('purchase-save-btn');
        setLoading(btn, true);
        const sel = document.getElementById('purchase-product');
        const productId = sel.value;
        const productName = sel.options[sel.selectedIndex]?.text?.split(' (')[0] || '';
        const qty = parseInt(document.getElementById('purchase-qty').value);
        const price = parseFloat(document.getElementById('purchase-price').value);
        const supplier = document.getElementById('purchase-supplier').value;
        const notes = document.getElementById('purchase-notes').value;
        const currentQty = parseInt(sel.options[sel.selectedIndex]?.dataset?.qty || 0);
        try {
            const base = db.collection('workspaces').doc(currentUser.uid);
            // Add purchase record
            await base.collection('purchases').add({
                productId, productName, qty, price, supplier, notes,
                total: qty * price,
                date: new Date().toISOString().split('T')[0],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            // Update product stock
            const newQty = currentQty + qty;
            let status = newQty === 0 ? 'out' : newQty < lowStockThreshold ? 'low' : 'in-stock';
            await base.collection('products').doc(productId).update({ quantity: newQty, status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            logActivity(`+${qty} Purchased`, productName, 'fa-cart-plus', 'text-emerald-500', 'bg-emerald-50');
            showToast(`Purchase recorded! Stock: ${currentQty} → ${newQty}`, 'success');
            closeModal('purchase-modal');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
        setLoading(btn, false);
    }

    function renderPurchases() {
        const tbody = document.getElementById('purchases-table');
        if (!purchases.length) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-cart-plus"></i><p>No purchases recorded yet</p></div></td></tr>'; return; }
        tbody.innerHTML = purchases.map(p => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 font-medium text-gray-800 text-sm">${p.productName}</td>
                <td class="px-6 py-4 text-sm font-bold text-emerald-600">+${p.qty}</td>
                <td class="px-6 py-4 text-sm text-gray-700">${formatPrice(p.price)}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${p.supplier || '—'}</td>
                <td class="px-6 py-4 text-sm text-gray-400">${p.date || ''}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${p.notes || '—'}</td>
            </tr>`).join('');
    }

    // ==================== SALES ====================
    function openSaleModal() {
        document.getElementById('sale-product').innerHTML = '<option value="">— Select Product —</option>' + products.filter(p=>p.quantity>0).map(p=>`<option value="${p.id}" data-price="${p.price}" data-qty="${p.quantity}">${p.name} (Stock: ${p.quantity})</option>`).join('');
        document.getElementById('sale-modal').querySelector('form').reset();
        document.getElementById('sale-modal').classList.remove('hidden');
    }

    function updateSaleMax() {
        const sel = document.getElementById('sale-product');
        const productId = sel.value;
        const p = products.find(x => x.id === productId);
        if (!p) {
            document.getElementById('sale-price-info').classList.add('hidden');
            document.getElementById('sale-profit-preview').classList.add('hidden');
            return;
        }
        const buy  = p.buyPrice  ?? p.price ?? 0;
        const sell = p.sellPrice ?? p.price ?? 0;
        const m    = buy > 0 ? Math.round(((sell - buy) / buy) * 100) : 0;
        document.getElementById('sale-qty').max = p.quantity;
        document.getElementById('sale-price').value = sell;
        document.getElementById('sale-buy-price-display').textContent  = formatPrice(buy);
        document.getElementById('sale-sell-price-display').textContent = formatPrice(sell);
        document.getElementById('sale-margin-display').textContent     = m + '%';
        document.getElementById('sale-price-info').classList.remove('hidden');
        updateSaleProfit();
    }

    function updateSaleProfit() {
        const sel = document.getElementById('sale-product');
        const p   = products.find(x => x.id === sel.value);
        if (!p) return;
        const qty  = parseInt(document.getElementById('sale-qty').value) || 0;
        const sell = parseFloat(document.getElementById('sale-price').value) || 0;
        const buy  = p.buyPrice ?? p.price ?? 0;
        if (qty < 1 || sell <= 0) { document.getElementById('sale-profit-preview').classList.add('hidden'); return; }
        const rev    = qty * sell;
        const cost   = qty * buy;
        const profit = rev - cost;
        document.getElementById('sp-revenue').textContent = formatPrice(rev);
        document.getElementById('sp-cost').textContent    = formatPrice(cost);
        document.getElementById('sp-profit').textContent  = formatPrice(profit);
        document.getElementById('sp-profit').className    = `font-bold text-base ${profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`;
        document.getElementById('sale-profit-preview').classList.remove('hidden');
    }

    async function saveSale(e) {
        e.preventDefault();
        const btn = document.getElementById('sale-save-btn');
        setLoading(btn, true);
        const sel = document.getElementById('sale-product');
        const productId = sel.value;
        const productName = sel.options[sel.selectedIndex]?.text?.split(' (')[0] || '';
        const qty = parseInt(document.getElementById('sale-qty').value);
        const price = parseFloat(document.getElementById('sale-price').value);
        const notes = document.getElementById('sale-notes').value;
        const currentQty = parseInt(sel.options[sel.selectedIndex]?.dataset?.qty || 0);
        const p = products.find(x => x.id === productId);
        const buyPrice = p?.buyPrice ?? p?.price ?? 0;
        const revenue = qty * price;
        const cost    = qty * buyPrice;
        const profit  = revenue - cost;
        if (qty > currentQty) { showToast(`Not enough stock! Available: ${currentQty}`, 'error'); setLoading(btn, false); return; }
        try {
            const base = db.collection('workspaces').doc(currentUser.uid);
            await base.collection('sales').add({
                productId, productName, qty, price, notes,
                revenue, cost, profit,
                date: new Date().toISOString().split('T')[0],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            const newQty = currentQty - qty;
            const minStock = p?.minStock || lowStockThreshold;
            let status = newQty === 0 ? 'out' : newQty < minStock ? 'low' : 'in-stock';
            await base.collection('products').doc(productId).update({ quantity: newQty, status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            logActivity(`−${qty} Sold`, productName, 'fa-cash-register', 'text-blue-500', 'bg-blue-50');
            showToast(`Sale recorded! Profit: ${formatPrice(profit)}`, 'success');
            closeModal('sale-modal');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
        setLoading(btn, false);
    }

    function renderSales() {
        const tbody = document.getElementById('sales-table');
        if (!sales_list.length) {
            tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-cash-register"></i><p>No sales recorded yet</p></div></td></tr>';
        } else {
            tbody.innerHTML = sales_list.map(s => {
                const profit = s.profit ?? (s.revenue - (s.cost || 0));
                return `
                <tr class="hover:bg-gray-50 transition-colors">
                    <td class="px-6 py-4 font-medium text-gray-800 text-sm">${s.productName}</td>
                    <td class="px-6 py-4 text-sm font-bold text-red-500">−${s.qty}</td>
                    <td class="px-6 py-4 text-sm text-gray-700">${formatPrice(s.price)}</td>
                    <td class="px-6 py-4 text-sm font-semibold text-emerald-600">${formatPrice(s.revenue)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${s.cost != null ? formatPrice(s.cost) : '—'}</td>
                    <td class="px-6 py-4 text-sm font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-500'}">${s.cost != null ? (profit >= 0 ? '+' : '') + formatPrice(profit) : '—'}</td>
                    <td class="px-6 py-4 text-sm text-gray-400">${s.date || ''}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${s.notes || '—'}</td>
                </tr>`;
            }).join('');
        }
        // Update totals bar
        const totalRev    = sales_list.reduce((a, s) => a + (s.revenue || 0), 0);
        const totalCost   = sales_list.reduce((a, s) => a + (s.cost || 0), 0);
        const totalProfit = totalRev - totalCost;
        const revEl    = document.getElementById('sales-total-revenue');
        const costEl   = document.getElementById('sales-total-cost');
        const profEl   = document.getElementById('sales-total-profit');
        if (revEl)  revEl.textContent  = formatPrice(totalRev);
        if (costEl) costEl.textContent = formatPrice(totalCost);
        if (profEl) {
            profEl.textContent = formatPrice(totalProfit);
            profEl.className = `font-bold ${totalProfit >= 0 ? 'text-blue-700' : 'text-red-600'}`;
        }
    }

    // ==================== ADJUSTMENTS ====================
    function openAdjustmentModal() {
        document.getElementById('adj-product').innerHTML = '<option value="">— Select Product —</option>' + products.map(p=>`<option value="${p.id}" data-qty="${p.quantity}">${p.name} (Stock: ${p.quantity})</option>`).join('');
        document.getElementById('adjustment-modal').querySelector('form').reset();
        document.getElementById('adj-current-stock').textContent = '—';
        document.getElementById('adjustment-modal').classList.remove('hidden');
    }

    function updateAdjCurrentStock() {
        const sel = document.getElementById('adj-product');
        const qty = sel.options[sel.selectedIndex]?.dataset?.qty;
        document.getElementById('adj-current-stock').textContent = qty !== undefined ? qty : '—';
    }

    async function saveAdjustment(e) {
        e.preventDefault();
        const btn = document.getElementById('adj-save-btn');
        setLoading(btn, true);
        const sel = document.getElementById('adj-product');
        const productId = sel.value;
        const productName = sel.options[sel.selectedIndex]?.text?.split(' (')[0] || '';
        const adjType = document.getElementById('adj-type').value;
        const adjQty = parseInt(document.getElementById('adj-qty').value);
        const reason = document.getElementById('adj-reason').value;
        const notes = document.getElementById('adj-notes').value;
        const currentQty = parseInt(sel.options[sel.selectedIndex]?.dataset?.qty || 0);
        let newQty;
        if (adjType === 'decrease') newQty = Math.max(0, currentQty - adjQty);
        else if (adjType === 'increase') newQty = currentQty + adjQty;
        else newQty = adjQty;
        const change = newQty - currentQty;
        try {
            const base = db.collection('workspaces').doc(currentUser.uid);
            await base.collection('adjustments').add({
                productId, productName, adjType, adjQty, newQty, change, reason, notes,
                date: new Date().toISOString().split('T')[0],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            let status = newQty === 0 ? 'out' : newQty < lowStockThreshold ? 'low' : 'in-stock';
            await base.collection('products').doc(productId).update({ quantity: newQty, status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            logActivity(`Adjusted (${reason})`, `${productName}: ${currentQty}→${newQty}`, 'fa-sliders', 'text-amber-500', 'bg-amber-50');
            showToast(`Adjustment saved! Stock: ${currentQty} → ${newQty}`, 'success');
            closeModal('adjustment-modal');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
        setLoading(btn, false);
    }

    function renderAdjustments() {
        const tbody = document.getElementById('adjustments-table');
        if (!adjustments_list.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="fas fa-sliders"></i><p>No adjustments recorded yet</p></div></td></tr>'; return; }
        tbody.innerHTML = adjustments_list.map(a => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 font-medium text-gray-800 text-sm">${a.productName}</td>
                <td class="px-6 py-4 text-sm font-bold ${a.change>=0?'text-emerald-600':'text-red-500'}">${a.change>=0?'+':''}${a.change} (→${a.newQty})</td>
                <td class="px-6 py-4"><span class="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">${a.reason}</span></td>
                <td class="px-6 py-4 text-sm text-gray-400">${a.date || ''}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${a.notes || '—'}</td>
            </tr>`).join('');
    }

    function toggleProfitBanner() {
        const banner = document.getElementById('profit-banner');
        const icon   = document.getElementById('profit-toggle-icon');
        const label  = document.getElementById('profit-toggle-label');
        const hidden = banner.style.display === 'none';
        if (hidden) {
            banner.style.display = '';
            icon.className  = 'fas fa-eye-slash';
            label.textContent = 'Hide';
            localStorage.setItem('profitBannerHidden', '0');
        } else {
            banner.style.display = 'none';
            icon.className  = 'fas fa-eye';
            label.textContent = 'Show';
            localStorage.setItem('profitBannerHidden', '1');
        }
    }

    function applyProfitBannerPreference() {
        if (localStorage.getItem('profitBannerHidden') === '1') {
            const banner = document.getElementById('profit-banner');
            const icon   = document.getElementById('profit-toggle-icon');
            const label  = document.getElementById('profit-toggle-label');
            if (banner) banner.style.display = 'none';
            if (icon)   icon.className = 'fas fa-eye';
            if (label)  label.textContent = 'Show';
        }
    }

    window.addEventListener('load', bootFirebase);

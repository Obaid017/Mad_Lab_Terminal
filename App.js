// ================================================================
// SMART STUDENT COMPANION APP — v5
// Zero external dependencies — works in Expo Snack out of the box
// Firebase Auth & Firestore via REST API (no SDK needed)
// AsyncStorage via in-memory store (Snack compatible)
// OpenWeatherMap API for live weather
// ================================================================

import React, {
  useState, useEffect, useRef, useCallback,
  createContext, useContext,
} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, StatusBar, FlatList, ActivityIndicator,
  Alert, Switch, Animated, KeyboardAvoidingView,
  Platform, Dimensions,
} from 'react-native';

const { width } = Dimensions.get('window');

// ─────────────────────────────────────────────
// THEME CONTEXT
// ─────────────────────────────────────────────
const ThemeContext = createContext();
const useTheme = () => useContext(ThemeContext);

const DARK = {
  bg: '#0F0F1A', surface: '#1A1A2E', card: '#16213E', border: '#2A2A4A',
  accent: '#6C63FF', accentSoft: '#9B96FF', accentBg: '#1E1B4B',
  success: '#10B981', danger: '#EF4444', warning: '#F59E0B',
  text: '#F0F0FF', textSec: '#9CA3AF', textMut: '#6B7280',
  teal: '#2DD4BF', pink: '#F472B6', orange: '#FB923C', isDark: true,
};
const LIGHT = {
  bg: '#F4F4FB', surface: '#FFFFFF', card: '#EEF0FB', border: '#D8DAF0',
  accent: '#6C63FF', accentSoft: '#5248CC', accentBg: '#ECEAFF',
  success: '#059669', danger: '#DC2626', warning: '#D97706',
  text: '#111128', textSec: '#4B4B6B', textMut: '#8888AA',
  teal: '#0D9488', pink: '#DB2777', orange: '#EA580C', isDark: false,
};

// ─────────────────────────────────────────────
// FIREBASE REST API CONFIG
// No SDK — pure fetch() calls to Firebase REST endpoints
// ─────────────────────────────────────────────
const FB = {
  apiKey:    'AIzaSyAGnx7UHg24plIDc9vpCEOOmQ_mt37IKGA',
  projectId: 'smartstudentcompanion-fc23c',
  // Firebase Auth REST base
  authBase:  'https://identitytoolkit.googleapis.com/v1/accounts',
  // Firestore REST base
  fsBase:    'https://firestore.googleapis.com/v1/projects/smartstudentcompanion-32314/databases/(default)/documents',
};

// In-memory session (Snack has no persistent token store, but works for the session)
let _idToken   = null;
let _uid       = null;
let _userEmail = null;

// ── Auth helpers ──
async function fbAuthRequest(endpoint, body) {
  const res = await fetch(`${FB.authBase}:${endpoint}?key=${FB.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    // Translate Firebase REST error codes
    const code = data?.error?.message || '';
    const map = {
      'EMAIL_EXISTS':              'This email is already registered.',
      'INVALID_EMAIL':             'Please enter a valid email address.',
      'WEAK_PASSWORD':             'Password must be at least 6 characters.',
      'EMAIL_NOT_FOUND':           'No account found with this email.',
      'INVALID_PASSWORD':          'Incorrect password. Please try again.',
      'INVALID_LOGIN_CREDENTIALS': 'Invalid email or password.',
      'TOO_MANY_ATTEMPTS_TRY_LATER': 'Too many attempts. Please try again later.',
      'USER_DISABLED':             'This account has been disabled.',
    };
    throw new Error(map[code] || `Auth error: ${code}`);
  }
  return data;
}

const FirebaseAuth = {
  signUp: async (email, password) => {
    const data = await fbAuthRequest('signUp', { email, password, returnSecureToken: true });
    _idToken = data.idToken; _uid = data.localId; _userEmail = data.email;
    return { email: data.email, uid: data.localId };
  },
  signIn: async (email, password) => {
    const data = await fbAuthRequest('signInWithPassword', { email, password, returnSecureToken: true });
    _idToken = data.idToken; _uid = data.localId; _userEmail = data.email;
    return { email: data.email, uid: data.localId };
  },
  signOut: () => { _idToken = null; _uid = null; _userEmail = null; },
  getUser: () => (_uid ? { email: _userEmail, uid: _uid } : null),
};

// ── Firestore REST helpers ──
// Convert JS value → Firestore value object
function toFsValue(val) {
  if (typeof val === 'string')  return { stringValue: val };
  if (typeof val === 'number')  return { doubleValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (val instanceof Date)      return { timestampValue: val.toISOString() };
  return { stringValue: String(val) };
}
// Convert Firestore value object → JS value
function fromFsValue(v) {
  if (v.stringValue    !== undefined) return v.stringValue;
  if (v.integerValue   !== undefined) return Number(v.integerValue);
  if (v.doubleValue    !== undefined) return Number(v.doubleValue);
  if (v.booleanValue   !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  return null;
}
function fsDocToObj(doc) {
  const fields = doc.fields || {};
  const obj = {};
  for (const k of Object.keys(fields)) obj[k] = fromFsValue(fields[k]);
  // Extract doc id from name: ".../documents/notes/DOC_ID"
  obj.id = doc.name?.split('/').pop() || '';
  return obj;
}
function objToFsFields(obj) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toFsValue(obj[k]);
  return fields;
}

let notesDb = []; // kept for home screen stats counter

const Firestore = {
  addNote: async (note) => {
    if (!_idToken) throw new Error('Not authenticated');
    const body = {
      fields: objToFsFields({
        ...note,
        uid: _uid,
        timestamp: new Date().toISOString(),
      }),
    };
    const res = await fetch(`${FB.fsBase}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_idToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Failed to add note');
    const saved = fsDocToObj(data);
    notesDb = [saved, ...notesDb];
    return saved;
  },

  deleteNote: async (id) => {
    if (!_idToken) return;
    await fetch(`${FB.fsBase}/notes/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${_idToken}` },
    });
    notesDb = notesDb.filter(n => n.id !== id);
  },

  // Firestore REST doesn't support real-time listeners — we poll
  fetchNotes: async () => {
    if (!_idToken || !_uid) return [];
    // Use Firestore structured query to filter by uid
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'notes' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'uid' },
            op: 'EQUAL',
            value: { stringValue: _uid },
          },
        },
        orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
      },
    };
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:runQuery`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${_idToken}`,
        },
        body: JSON.stringify(body),
      }
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    const notes = rows
      .filter(r => r.document)
      .map(r => fsDocToObj(r.document));
    notesDb = notes;
    return notes;
  },
};

// ─────────────────────────────────────────────
// IN-MEMORY ASYNC STORAGE
// (Expo Snack doesn't support @react-native-async-storage)
// Simulates the exact same API — swap for the real package when
// running on a real device / managed Expo project
// ─────────────────────────────────────────────
const _store = {};
const AsyncStorage = {
  setItem:    async (key, val) => { _store[key] = String(val); },
  getItem:    async (key)      => (_store[key] !== undefined ? _store[key] : null),
  removeItem: async (key)      => { delete _store[key]; },
};

// ─────────────────────────────────────────────
// OPEN WEATHER MAP API KEY
// Get a free key at https://openweathermap.org/api
// Replace the string below with your actual key
// ─────────────────────────────────────────────
const OWM_KEY = 'YOUR_OPENWEATHERMAP_API_KEY';

// ─────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────
const TABS = [
  { key: 'home',    label: 'Home',    icon: '🏠' },
  { key: 'notes',   label: 'Notes',   icon: '📝' },
  { key: 'explore', label: 'Explore', icon: '🌍' },
  { key: 'settings',label: 'Settings',icon: '⚙️' },
];

// ─────────────────────────────────────────────
// SPLASH SCREEN
// ─────────────────────────────────────────────
function SplashScreen({ onDone }) {
  const scale   = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();
    Animated.timing(slideUp, { toValue: 0, duration: 800, delay: 300, useNativeDriver: true }).start();
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]); // ✅ ESLint: include onDone

  return (
    <View style={{ flex:1, backgroundColor:'#0F0F1A', alignItems:'center', justifyContent:'center' }}>
      <StatusBar barStyle="light-content" backgroundColor="#0F0F1A" />
      <Animated.View style={{ transform:[{scale}], opacity }}>
        <View style={{ width:120, height:120, borderRadius:30, backgroundColor:'#1E1B4B',
          borderWidth:2, borderColor:'#6C63FF', alignItems:'center', justifyContent:'center', marginBottom:24 }}>
          <Text style={{ fontSize:52 }}>🎓</Text>
        </View>
      </Animated.View>
      <Animated.View style={{ transform:[{translateY:slideUp}], opacity, alignItems:'center' }}>
        <Text style={{ fontSize:26, fontWeight:'800', color:'#F0F0FF', letterSpacing:0.5 }}>Smart Student</Text>
        <Text style={{ fontSize:26, fontWeight:'800', color:'#6C63FF', letterSpacing:0.5 }}>Companion</Text>
        <Text style={{ fontSize:15, color:'#9CA3AF', marginTop:8 }}>Your AI-powered study buddy</Text>
      </Animated.View>
      <Animated.View style={{ flexDirection:'row', gap:8, marginTop:60, opacity }}>
        {[0,1,2].map(i => (
          <View key={i} style={{ width:8, height:8, borderRadius:4,
            backgroundColor: i===1 ? '#6C63FF' : '#2A2A4A' }} />
        ))}
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const C = useTheme();
  const [mode, setMode]           = useState('login');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirmPass, setConfirm] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [showPass, setShowPass]   = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const switchMode = useCallback(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue:0, duration:150, useNativeDriver:true }),
      Animated.timing(fadeAnim, { toValue:1, duration:300, useNativeDriver:true }),
    ]).start();
    setMode(m => m==='login' ? 'signup' : 'login');
    setError(''); setEmail(''); setPassword(''); setConfirm('');
  }, [fadeAnim]);

  const validate = () => {
    if (!email.trim())         return 'Email is required.';
    if (!email.includes('@'))  return 'Enter a valid email.';
    if (!password)             return 'Password is required.';
    if (password.length < 6)  return 'Password must be at least 6 characters.';
    if (mode==='signup' && password!==confirmPass) return 'Passwords do not match.';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(''); setLoading(true);
    try {
      const user = mode==='login'
        ? await FirebaseAuth.signIn(email, password)
        : await FirebaseAuth.signUp(email, password);
      onLogin(user);
    } catch (e) {
      setError(e.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    backgroundColor:C.card, borderRadius:12, borderWidth:1, borderColor:C.border,
    color:C.text, fontSize:15, paddingHorizontal:16, paddingVertical:12, marginBottom:14,
  };

  return (
    <KeyboardAvoidingView style={{flex:1, backgroundColor:C.bg}}
      behavior={Platform.OS==='ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{flexGrow:1, padding:24, paddingTop:48, backgroundColor:C.bg}}
        keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={{alignItems:'center', marginBottom:32}}>
          <View style={{width:80, height:80, borderRadius:20, backgroundColor:C.accentBg,
            borderWidth:1.5, borderColor:C.accent, alignItems:'center', justifyContent:'center', marginBottom:12}}>
            <Text style={{fontSize:36}}>🎓</Text>
          </View>
          <Text style={{fontSize:20, fontWeight:'800', color:C.text, textAlign:'center'}}>Smart Student Companion</Text>
          <Text style={{fontSize:14, color:C.textSec, marginTop:4}}>Your Smart Study Buddy</Text>
        </View>

        <Animated.View style={{backgroundColor:C.surface, borderRadius:20, padding:24,
          borderWidth:1, borderColor:C.border, opacity:fadeAnim}}>
          <Text style={{fontSize:22, fontWeight:'700', color:C.text, marginBottom:4}}>
            {mode==='login' ? 'Welcome Back 👋' : 'Create Account ✨'}
          </Text>
          <Text style={{fontSize:14, color:C.textSec, marginBottom:20}}>
            {mode==='login' ? 'Sign in to continue' : 'Join Smart Student Companion today'}
          </Text>

          {!!error && (
            <View style={{backgroundColor:C.isDark?'#2d0f0f':'#FEE2E2', borderRadius:10,
              borderWidth:1, borderColor:C.danger, padding:12, marginBottom:14}}>
              <Text style={{color:C.danger, fontSize:13, fontWeight:'600'}}>⚠️  {error}</Text>
            </View>
          )}

          <Text style={{fontSize:13, color:C.textSec, marginBottom:6, fontWeight:'600'}}>Email Address</Text>
          <TextInput style={inp} placeholder="student@university.edu"
            placeholderTextColor={C.textMut} value={email}
            onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/>

          <Text style={{fontSize:13, color:C.textSec, marginBottom:6, fontWeight:'600'}}>Password</Text>
          <View style={{flexDirection:'row', gap:8, marginBottom:14}}>
            <TextInput style={[inp,{flex:1, marginBottom:0}]} placeholder="••••••••"
              placeholderTextColor={C.textMut} value={password}
              onChangeText={setPassword} secureTextEntry={!showPass}/>
            <TouchableOpacity onPress={()=>setShowPass(p=>!p)}
              style={{justifyContent:'center', paddingHorizontal:12}}>
              <Text style={{fontSize:20}}>{showPass ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          {mode==='signup' && (
            <>
              <Text style={{fontSize:13, color:C.textSec, marginBottom:6, fontWeight:'600'}}>Confirm Password</Text>
              <TextInput style={inp} placeholder="••••••••"
                placeholderTextColor={C.textMut} value={confirmPass}
                onChangeText={setConfirm} secureTextEntry={!showPass}/>
            </>
          )}

          <TouchableOpacity style={{backgroundColor:C.accent, borderRadius:14,
            paddingVertical:15, alignItems:'center', marginBottom:12, opacity:loading?0.7:1}}
            onPress={handleSubmit} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff"/>
              : <Text style={{color:'#fff', fontWeight:'700', fontSize:16}}>
                  {mode==='login' ? '🔓  Sign In' : '🚀  Create Account'}
                </Text>}
          </TouchableOpacity>

          <View style={{flexDirection:'row', alignItems:'center', marginVertical:16, gap:12}}>
            <View style={{flex:1, height:1, backgroundColor:C.border}}/>
            <Text style={{color:C.textSec, fontSize:13}}>or</Text>
            <View style={{flex:1, height:1, backgroundColor:C.border}}/>
          </View>

          <TouchableOpacity onPress={switchMode} style={{alignItems:'center', paddingVertical:8}}>
            <Text style={{color:C.textSec, fontSize:14}}>
              {mode==='login' ? "Don't have an account? " : "Already have an account? "}
              <Text style={{color:C.accent, fontWeight:'700'}}>
                {mode==='login' ? 'Sign Up' : 'Sign In'}
              </Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────
// HOME SCREEN
// ─────────────────────────────────────────────
function HomeScreen({ user, onLogout, onNavigate }) {
  const C = useTheme();
  const [loggingOut, setLoggingOut] = useState(false);
  const [noteCount,  setNoteCount]  = useState(notesDb.length);
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue:0, duration:600, useNativeDriver:true }),
      Animated.timing(fadeAnim,  { toValue:1, duration:600, useNativeDriver:true }),
    ]).start();
    // Refresh note count when screen mounts
    setNoteCount(notesDb.length);
  }, [slideAnim, fadeAnim]); // ✅ ESLint fix

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text:'Cancel', style:'cancel' },
      { text:'Logout', style:'destructive', onPress: async () => {
          setLoggingOut(true);
          FirebaseAuth.signOut();
          onLogout();
        }
      },
    ]);
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const quickActions = [
    { icon:'📝', label:'Add Note',  color:C.accent,  tab:'notes'    },
    { icon:'🌤️', label:'Weather',  color:C.teal,    tab:'explore'  },
    { icon:'🎬', label:'Movies',   color:C.pink,    tab:'explore'  },
    { icon:'⚙️', label:'Settings', color:C.orange,  tab:'settings' },
  ];
  const stats = [
    { icon:'📝', label:'Notes',    value: String(noteCount), color:C.accent  },
    { icon:'⭐', label:'Streak',   value:'7 days',           color:C.warning },
    { icon:'📚', label:'Subjects', value:'5',                color:C.teal    },
    { icon:'✅', label:'Tasks',    value:'12',               color:C.success },
  ];

  return (
    <ScrollView style={{flex:1, backgroundColor:C.bg}} showsVerticalScrollIndicator={false}>
      {/* Banner */}
      <Animated.View style={{margin:16, padding:20, borderRadius:20,
        backgroundColor:C.accentBg, borderWidth:1, borderColor:C.accent+'44',
        flexDirection:'row', alignItems:'center',
        opacity:fadeAnim, transform:[{translateY:slideAnim}]}}>
        <View style={{flex:1}}>
          <Text style={{fontSize:13, color:C.accentSoft, fontWeight:'600', marginBottom:4}}>
            {getGreeting()} 👋
          </Text>
          <Text style={{fontSize:16, fontWeight:'700', color:C.text, maxWidth:200}} numberOfLines={1}>
            {user?.email}
          </Text>
          <Text style={{fontSize:13, color:C.textSec, marginTop:4}}>Ready to study?</Text>
        </View>
        <View style={{width:56, height:56, borderRadius:28, backgroundColor:C.card,
          borderWidth:2, borderColor:C.accent, alignItems:'center', justifyContent:'center'}}>
          <Text style={{fontSize:26}}>🎓</Text>
        </View>
      </Animated.View>

      {/* Stats */}
      <Text style={{fontSize:18, fontWeight:'700', color:C.text, paddingHorizontal:16, marginBottom:12, marginTop:4}}>
        📊 Your Stats
      </Text>
      <View style={{flexDirection:'row', flexWrap:'wrap', paddingHorizontal:12, gap:10}}>
        {stats.map((s,i) => (
          <View key={i} style={{flex:1, minWidth:'45%', backgroundColor:C.surface,
            borderRadius:16, borderWidth:1, borderColor:s.color+'44',
            padding:16, alignItems:'center', gap:6}}>
            <Text style={{fontSize:22}}>{s.icon}</Text>
            <Text style={{fontSize:20, fontWeight:'800', color:s.color}}>{s.value}</Text>
            <Text style={{fontSize:12, color:C.textSec}}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Quote */}
      <View style={{margin:16, padding:20, backgroundColor:C.card, borderRadius:16,
        borderLeftWidth:4, borderLeftColor:C.accent}}>
        <Text style={{fontSize:20, marginBottom:8}}>💡</Text>
        <Text style={{fontSize:14, color:C.text, fontStyle:'italic', lineHeight:22}}>
          "The more that you read, the more things you will know."
        </Text>
        <Text style={{fontSize:12, color:C.accentSoft, marginTop:8, fontWeight:'600'}}>— Dr. Seuss</Text>
      </View>

      {/* Quick Actions */}
      <Text style={{fontSize:18, fontWeight:'700', color:C.text, paddingHorizontal:16, marginBottom:12}}>
        ⚡ Quick Actions
      </Text>
      <View style={{flexDirection:'row', paddingHorizontal:12, gap:10, marginBottom:16}}>
        {quickActions.map((a,i) => (
          <TouchableOpacity key={i}
            style={{flex:1, backgroundColor:C.surface, borderRadius:14,
              borderWidth:1, borderColor:a.color+'55', paddingVertical:14, alignItems:'center', gap:6}}
            onPress={() => onNavigate(a.tab)} activeOpacity={0.7}>
            <Text style={{fontSize:24}}>{a.icon}</Text>
            <Text style={{fontSize:11, fontWeight:'600', color:a.color}}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity
        style={{margin:16, padding:16, backgroundColor:C.isDark?'#1a0808':'#FEE2E2',
          borderRadius:14, borderWidth:1, borderColor:C.danger, alignItems:'center',
          opacity:loggingOut ? 0.6 : 1}}
        onPress={handleLogout} disabled={loggingOut}>
        {loggingOut
          ? <ActivityIndicator color={C.danger}/>
          : <Text style={{color:C.danger, fontWeight:'700', fontSize:15}}>🚪  Logout</Text>}
      </TouchableOpacity>
      <View style={{height:30}}/>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────
// NOTES SCREEN  (Firestore via REST, polled)
// ─────────────────────────────────────────────
function NotesScreen() {
  const C = useTheme();
  const [notes,    setNotes]    = useState([]);
  const [title,    setTitle]    = useState('');
  const [desc,     setDesc]     = useState('');
  const [adding,   setAdding]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error,    setError]    = useState('');
  const slideAnim = useRef(new Animated.Value(-220)).current;

  const loadNotes = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const fetched = await Firestore.fetchNotes();
      setNotes(fetched);
    } catch (e) {
      setError('Could not load notes: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const openForm = () => {
    setShowForm(true);
    Animated.spring(slideAnim, { toValue:0, tension:70, friction:10, useNativeDriver:true }).start();
  };
  const closeForm = () => {
    Animated.timing(slideAnim, { toValue:-220, duration:250, useNativeDriver:true })
      .start(() => { setShowForm(false); setTitle(''); setDesc(''); });
  };

  const addNote = async () => {
    if (!title.trim()) { Alert.alert('Error','Title is required.'); return; }
    if (!desc.trim())  { Alert.alert('Error','Description is required.'); return; }
    setAdding(true);
    try {
      const saved = await Firestore.addNote({ title:title.trim(), description:desc.trim() });
      setNotes(prev => [saved, ...prev]);
      closeForm();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setAdding(false);
    }
  };

  const deleteNote = (id, t) => Alert.alert('Delete Note', `Delete "${t}"?`, [
    { text:'Cancel', style:'cancel' },
    { text:'Delete', style:'destructive', onPress: async () => {
        await Firestore.deleteNote(id);
        setNotes(prev => prev.filter(n => n.id !== id));
      }
    },
  ]);

  const fmt = iso => {
    try { return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
    catch { return ''; }
  };

  return (
    <View style={{flex:1, backgroundColor:C.bg}}>
      {/* Header */}
      <View style={{flexDirection:'row', justifyContent:'space-between',
        alignItems:'center', padding:16, paddingBottom:12}}>
        <View>
          <Text style={{fontSize:22, fontWeight:'800', color:C.text}}>My Notes 📝</Text>
          <Text style={{fontSize:13, color:C.textSec, marginTop:2}}>
            {notes.length} notes · stored in Firestore
          </Text>
        </View>
        <View style={{flexDirection:'row', gap:8}}>
          <TouchableOpacity onPress={loadNotes}
            style={{width:40, height:40, borderRadius:20, backgroundColor:C.card,
              borderWidth:1, borderColor:C.border, alignItems:'center', justifyContent:'center'}}>
            <Text style={{fontSize:18}}>🔄</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openForm}
            style={{width:44, height:44, borderRadius:22, backgroundColor:C.accent,
              alignItems:'center', justifyContent:'center'}}>
            <Text style={{color:'#fff', fontSize:22, lineHeight:26}}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!!error && (
        <View style={{marginHorizontal:16, marginBottom:8, backgroundColor:C.isDark?'#2d0f0f':'#FEE2E2',
          borderRadius:10, borderWidth:1, borderColor:C.danger, padding:10}}>
          <Text style={{color:C.danger, fontSize:13}}>⚠️ {error}</Text>
        </View>
      )}

      {/* Add Form */}
      {showForm && (
        <Animated.View style={{backgroundColor:C.surface, margin:16, marginTop:0,
          borderRadius:16, padding:16, borderWidth:1, borderColor:C.border,
          transform:[{translateY:slideAnim}]}}>
          <Text style={{fontSize:16, fontWeight:'700', color:C.text, marginBottom:12}}>✏️ New Note</Text>
          <TextInput style={{backgroundColor:C.card, borderRadius:12, borderWidth:1,
            borderColor:C.border, color:C.text, fontSize:15, paddingHorizontal:16,
            paddingVertical:12, marginBottom:10}}
            placeholder="Note title..." placeholderTextColor={C.textMut}
            value={title} onChangeText={setTitle}/>
          <TextInput style={{backgroundColor:C.card, borderRadius:12, borderWidth:1,
            borderColor:C.border, color:C.text, fontSize:15, paddingHorizontal:16,
            paddingVertical:12, marginBottom:14, height:80, textAlignVertical:'top'}}
            placeholder="Note description..." placeholderTextColor={C.textMut}
            value={desc} onChangeText={setDesc} multiline/>
          <View style={{flexDirection:'row', gap:10}}>
            <TouchableOpacity onPress={closeForm}
              style={{backgroundColor:C.card, borderRadius:12, borderWidth:1,
                borderColor:C.border, paddingVertical:12, paddingHorizontal:18, alignItems:'center'}}>
              <Text style={{color:C.textSec, fontWeight:'600'}}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={addNote} disabled={adding}
              style={{flex:1, backgroundColor:C.accent, borderRadius:12,
                paddingVertical:12, alignItems:'center', opacity:adding?0.7:1}}>
              {adding
                ? <ActivityIndicator color="#fff" size="small"/>
                : <Text style={{color:'#fff', fontWeight:'700'}}>Save to Firestore</Text>}
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {loading && !showForm ? (
        <View style={{flex:1, alignItems:'center', justifyContent:'center', gap:12}}>
          <ActivityIndicator color={C.accent} size="large"/>
          <Text style={{color:C.textSec}}>Loading from Firestore...</Text>
        </View>
      ) : notes.length === 0 ? (
        <View style={{flex:1, alignItems:'center', justifyContent:'center', gap:12}}>
          <Text style={{fontSize:60}}>📭</Text>
          <Text style={{fontSize:20, fontWeight:'700', color:C.text}}>No Notes Yet</Text>
          <Text style={{fontSize:14, color:C.textSec}}>Tap + to add your first note</Text>
        </View>
      ) : (
        <FlatList data={notes} keyExtractor={item => item.id || item.timestamp}
          contentContainerStyle={{padding:16, paddingTop:8}}
          showsVerticalScrollIndicator={false}
          renderItem={({item}) => (
            <View style={{backgroundColor:C.surface, borderRadius:16, borderWidth:1,
              borderColor:C.border, marginBottom:12}}>
              <View style={{flexDirection:'row', padding:16, gap:12}}>
                <View style={{flex:1}}>
                  <Text style={{fontSize:16, fontWeight:'700', color:C.text, marginBottom:6}}>
                    {item.title}
                  </Text>
                  <Text style={{fontSize:14, color:C.textSec, lineHeight:20}} numberOfLines={3}>
                    {item.description}
                  </Text>
                  <Text style={{fontSize:12, color:C.textMut, marginTop:10}}>
                    🕐 {fmt(item.timestamp)}
                  </Text>
                </View>
                <TouchableOpacity onPress={()=>deleteNote(item.id, item.title)} style={{padding:4}}>
                  <Text style={{fontSize:18}}>🗑️</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}/>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────
// EXPLORE SCREEN  (Weather + Movies)
// ─────────────────────────────────────────────
function ExploreScreen({ onSelectMovie }) {
  const C = useTheme();
  const [tab,        setTab]        = useState('weather');
  const [city,       setCity]       = useState('Islamabad');
  const [weather,    setWeather]    = useState(null);
  const [wLoad,      setWLoad]      = useState(false);
  const [wErr,       setWErr]       = useState('');
  const [movies,     setMovies]     = useState([]);
  const [mLoad,      setMLoad]      = useState(false);
  const [mErr,       setMErr]       = useState('');

  const EMOJI_MAP = {
    '01d':'☀️','01n':'🌙','02d':'⛅','02n':'⛅','03d':'☁️','03n':'☁️',
    '04d':'☁️','04n':'☁️','09d':'🌧️','09n':'🌧️','10d':'🌦️','10n':'🌧️',
    '11d':'⛈️','11n':'⛈️','13d':'❄️','13n':'❄️','50d':'🌫️','50n':'🌫️',
  };

  const fetchWeather = useCallback(async () => {
    if (!city.trim()) { setWErr('Enter a city name.'); return; }
    setWLoad(true); setWErr(''); setWeather(null);
    try {
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city.trim())}&units=metric&appid=${OWM_KEY}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'City not found');
      const ic = data.weather[0]?.icon || '01d';
      setWeather({
        city:      data.name,
        country:   data.sys?.country || '',
        temp:      Math.round(data.main.temp),
        feels:     Math.round(data.main.feels_like),
        condition: (data.weather[0]?.description || '').replace(/\b\w/g, c => c.toUpperCase()),
        icon:      EMOJI_MAP[ic] || '🌡️',
        humidity:  data.main.humidity,
        wind:      Math.round((data.wind?.speed || 0) * 3.6),
      });
    } catch (e) {
      setWErr(e.message.includes('401')
        ? '⚠️ Invalid API key. Get a free key at openweathermap.org'
        : `⚠️ ${e.message}`);
    } finally { setWLoad(false); }
  }, [city]); // ✅ ESLint: city is a dependency

  const fetchMovies = useCallback(async () => {
    setMLoad(true); setMErr('');
    try {
      const res  = await fetch('https://dummyjson.com/products?limit=20');
      const data = await res.json();
      setMovies(data.products.map(p => ({
        id: p.id, title: p.title, description: p.description,
        rating: p.rating, year: 2020+(p.id%5),
        genre: ['Action','Drama','Sci-Fi','Comedy','Thriller'][p.id%5],
        price: p.price,
      })));
    } catch { setMErr('Failed to load products. Check your connection.'); }
    finally  { setMLoad(false); }
  }, []);

  useEffect(() => {
    fetchWeather();
    fetchMovies();
  }, [fetchWeather, fetchMovies]); // ✅ ESLint fix

  const inp = {
    backgroundColor:C.card, borderRadius:12, borderWidth:1, borderColor:C.border,
    color:C.text, fontSize:15, paddingHorizontal:16, paddingVertical:12,
  };

  return (
    <View style={{flex:1, backgroundColor:C.bg}}>
      {/* Tab switcher */}
      <View style={{flexDirection:'row', margin:16, marginBottom:8, backgroundColor:C.surface,
        borderRadius:14, padding:4, borderWidth:1, borderColor:C.border}}>
        {[{k:'weather',l:'🌤️ Weather'},{k:'movies',l:'🎬 Products'}].map(({k,l}) => (
          <TouchableOpacity key={k} onPress={()=>setTab(k)}
            style={{flex:1, paddingVertical:10, alignItems:'center', borderRadius:11,
              backgroundColor: tab===k ? C.card : 'transparent'}}>
            <Text style={{fontWeight:'600', fontSize:14, color:tab===k?C.accent:C.textSec}}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* WEATHER TAB */}
      {tab==='weather' && (
        <ScrollView contentContainerStyle={{padding:16}} showsVerticalScrollIndicator={false}>
          <Text style={{fontSize:18, fontWeight:'700', color:C.text, marginBottom:12}}>🌍 Live Weather</Text>

          <View style={{flexDirection:'row', gap:10, marginBottom:16}}>
            <TextInput style={[inp,{flex:1}]} placeholder="Enter city..."
              placeholderTextColor={C.textMut} value={city}
              onChangeText={setCity} onSubmitEditing={fetchWeather}/>
            <TouchableOpacity onPress={fetchWeather}
              style={{backgroundColor:C.accent, borderRadius:12, paddingHorizontal:16, justifyContent:'center'}}>
              <Text style={{color:'#fff', fontWeight:'700'}}>Search</Text>
            </TouchableOpacity>
          </View>

          {wLoad && (
            <View style={{alignItems:'center', padding:30, gap:12}}>
              <ActivityIndicator color={C.accent} size="large"/>
              <Text style={{color:C.textSec}}>Fetching weather...</Text>
            </View>
          )}
          {!!wErr && (
            <View style={{backgroundColor:C.isDark?'#2d0f0f':'#FEE2E2', borderRadius:10,
              borderWidth:1, borderColor:C.danger, padding:12, marginBottom:14}}>
              <Text style={{color:C.danger, fontWeight:'600'}}>{wErr}</Text>
            </View>
          )}
          {weather && !wLoad && (
            <View style={{backgroundColor:C.card, borderRadius:20, padding:20,
              borderWidth:1, borderColor:C.border, marginBottom:20}}>
              <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:8}}>
                <View>
                  <Text style={{fontSize:18, fontWeight:'700', color:C.text}}>
                    📍 {weather.city}{weather.country ? `, ${weather.country}` : ''}
                  </Text>
                  <Text style={{fontSize:14, color:C.textSec, marginTop:2}}>{weather.condition}</Text>
                </View>
                <Text style={{fontSize:48}}>{weather.icon}</Text>
              </View>
              <Text style={{fontSize:52, fontWeight:'800', color:C.text, marginBottom:4}}>
                {weather.temp}°C
              </Text>
              <Text style={{fontSize:13, color:C.textSec, marginBottom:16}}>
                Feels like {weather.feels}°C
              </Text>
              <View style={{flexDirection:'row', borderTopWidth:1, borderColor:C.border, paddingTop:16}}>
                {[
                  {icon:'💧', val:`${weather.humidity}%`,                      lbl:'Humidity'},
                  {icon:'💨', val:`${weather.wind} km/h`,                      lbl:'Wind',   border:true},
                  {icon:'🌡️',val:`${Math.round(weather.temp*9/5+32)}°F`,      lbl:'Fahrenheit'},
                ].map((s,i) => (
                  <View key={i} style={{flex:1, alignItems:'center', gap:4,
                    borderLeftWidth:s.border?1:0, borderRightWidth:s.border?1:0, borderColor:C.border}}>
                    <Text style={{fontSize:20}}>{s.icon}</Text>
                    <Text style={{fontSize:15, fontWeight:'700', color:C.text}}>{s.val}</Text>
                    <Text style={{fontSize:11, color:C.textSec}}>{s.lbl}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <Text style={{fontSize:16, fontWeight:'700', color:C.text, marginBottom:10}}>🏙️ Popular Cities</Text>
          <View style={{flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:20}}>
            {['London','Paris','Tokyo','Dubai','Lahore','Karachi','Islamabad','New York'].map(c => (
              <TouchableOpacity key={c} onPress={()=>setCity(c)}
                style={{backgroundColor:C.surface, borderRadius:20, borderWidth:1,
                  borderColor:C.border, paddingHorizontal:14, paddingVertical:8}}>
                <Text style={{color:C.text, fontSize:13, fontWeight:'500'}}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {/* MOVIES / PRODUCTS TAB */}
      {tab==='movies' && (
        mLoad ? (
          <View style={{flex:1, alignItems:'center', justifyContent:'center', gap:12}}>
            <ActivityIndicator color={C.accent} size="large"/>
            <Text style={{color:C.textSec}}>Loading products...</Text>
          </View>
        ) : mErr ? (
          <View style={{padding:16}}>
            <View style={{backgroundColor:C.isDark?'#2d0f0f':'#FEE2E2', borderRadius:10,
              borderWidth:1, borderColor:C.danger, padding:12, marginBottom:14}}>
              <Text style={{color:C.danger, fontWeight:'600'}}>⚠️  {mErr}</Text>
            </View>
            <TouchableOpacity onPress={fetchMovies}
              style={{backgroundColor:C.accent, borderRadius:14, paddingVertical:14, alignItems:'center'}}>
              <Text style={{color:'#fff', fontWeight:'700'}}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList data={movies} keyExtractor={item=>String(item.id)}
            contentContainerStyle={{padding:16, paddingTop:4}}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <Text style={{fontSize:18, fontWeight:'700', color:C.text, marginBottom:12}}>🎬 Featured Products</Text>
            }
            renderItem={({item}) => (
              <TouchableOpacity onPress={()=>onSelectMovie(item)}
                style={{backgroundColor:C.surface, borderRadius:16, borderWidth:1,
                  borderColor:C.border, marginBottom:12, flexDirection:'row', overflow:'hidden'}}
                activeOpacity={0.8}>
                <View style={{width:90, backgroundColor:C.accentBg, alignItems:'center', justifyContent:'center'}}>
                  <Text style={{fontSize:36}}>🎬</Text>
                </View>
                <View style={{flex:1, padding:14}}>
                  <Text style={{fontSize:15, fontWeight:'700', color:C.text, marginBottom:6}} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{fontSize:13, color:C.textSec, lineHeight:18, marginBottom:8}} numberOfLines={2}>
                    {item.description}
                  </Text>
                  <View style={{flexDirection:'row', gap:6, flexWrap:'wrap'}}>
                    <Text style={{fontSize:12, fontWeight:'600', color:C.warning,
                      backgroundColor:C.card, borderRadius:6, paddingHorizontal:8, paddingVertical:3}}>
                      ⭐ {item.rating?.toFixed(1)}
                    </Text>
                    <Text style={{fontSize:12, fontWeight:'600', color:C.textSec,
                      backgroundColor:C.card, borderRadius:6, paddingHorizontal:8, paddingVertical:3}}>
                      {item.year}
                    </Text>
                    <Text style={{fontSize:12, fontWeight:'600', color:C.teal,
                      backgroundColor:C.card, borderRadius:6, paddingHorizontal:8, paddingVertical:3}}>
                      {item.genre}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}/>
        )
      )}
    </View>
  );
}

// ─────────────────────────────────────────────
// DETAILS SCREEN
// ─────────────────────────────────────────────
function DetailsScreen({ item, onBack }) {
  const C = useTheme();
  const slideX = useRef(new Animated.Value(width)).current;

  useEffect(() => {
    Animated.spring(slideX, { toValue:0, tension:80, friction:12, useNativeDriver:true }).start();
  }, [slideX]); // ✅ ESLint fix

  const handleBack = () =>
    Animated.timing(slideX, { toValue:width, duration:250, useNativeDriver:true }).start(onBack);

  return (
    <Animated.View style={{flex:1, backgroundColor:C.bg, transform:[{translateX:slideX}]}}>
      <SafeAreaView style={{flex:1}}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{height:240, backgroundColor:C.accentBg, alignItems:'center', justifyContent:'center'}}>
            <Text style={{fontSize:80}}>🎬</Text>
            <TouchableOpacity onPress={handleBack}
              style={{position:'absolute', top:16, left:16, backgroundColor:C.surface+'dd',
                borderRadius:20, paddingHorizontal:16, paddingVertical:8, borderWidth:1, borderColor:C.border}}>
              <Text style={{color:C.text, fontWeight:'600'}}>← Back</Text>
            </TouchableOpacity>
          </View>
          <View style={{padding:20}}>
            <Text style={{fontSize:24, fontWeight:'800', color:C.text, marginBottom:12}}>{item.title}</Text>
            <View style={{flexDirection:'row', gap:8, marginBottom:20, flexWrap:'wrap'}}>
              {[
                {bg:C.isDark?'#1a1400':'#FEF3C7', c:C.warning,    t:`⭐ ${item.rating?.toFixed(1)}`},
                {bg:C.accentBg,                   c:C.accentSoft, t:String(item.year)},
                {bg:C.isDark?'#0d3d3a':'#CCFBF1', c:C.teal,      t:item.genre},
              ].map((b,i) => (
                <View key={i} style={{backgroundColor:b.bg, borderRadius:8, paddingHorizontal:10, paddingVertical:5}}>
                  <Text style={{fontSize:13, fontWeight:'600', color:b.c}}>{b.t}</Text>
                </View>
              ))}
            </View>
            <Text style={{fontSize:13, color:C.accent, fontWeight:'700', marginBottom:8, letterSpacing:1}}>OVERVIEW</Text>
            <Text style={{fontSize:15, color:C.textSec, lineHeight:24, marginBottom:24}}>{item.description}</Text>
            <View style={{flexDirection:'row', backgroundColor:C.surface, borderRadius:16,
              padding:16, marginBottom:20, borderWidth:1, borderColor:C.border}}>
              {[
                {v:`⭐ ${item.rating?.toFixed(1)}`, l:'Rating'},
                {v:String(item.year),               l:'Year'},
                {v:`$${item.price}`,                l:'Price'},
              ].map((s,i) => (
                <View key={i} style={{flex:1, alignItems:'center', gap:6}}>
                  <Text style={{fontSize:18, fontWeight:'800', color:C.text}}>{s.v}</Text>
                  <Text style={{fontSize:12, color:C.textSec}}>{s.l}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={{backgroundColor:C.accent, borderRadius:14,
              paddingVertical:15, alignItems:'center', marginBottom:12}}>
              <Text style={{color:'#fff', fontWeight:'700', fontSize:16}}>▶  View Details</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{backgroundColor:C.accentBg, borderRadius:14, borderWidth:1,
              borderColor:C.accent, paddingVertical:13, alignItems:'center'}}>
              <Text style={{color:C.accentSoft, fontWeight:'600', fontSize:15}}>＋  Save to List</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────
// SETTINGS SCREEN
// ─────────────────────────────────────────────
function SettingsScreen({ darkMode, setDarkMode }) {
  const C = useTheme();
  const [username, setUsername] = useState('');
  const [subject,  setSubject]  = useState('');
  const [status,   setStatus]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const subjects = ['Mathematics','Physics','Chemistry','Biology','Computer Science','History','English'];

  const showStatus = (msg, isErr=false) => {
    setStatus({msg,isErr});
    setTimeout(() => setStatus(null), 3000);
  };

  const saveData = async () => {
    setLoading(true);
    try {
      await AsyncStorage.setItem('username', username);
      await AsyncStorage.setItem('darkMode', darkMode ? 'true' : 'false');
      await AsyncStorage.setItem('subject', subject);
      showStatus('✅ Preferences saved successfully!');
    } catch { showStatus('❌ Failed to save.', true); }
    finally  { setLoading(false); }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const u = await AsyncStorage.getItem('username');
      const d = await AsyncStorage.getItem('darkMode');
      const s = await AsyncStorage.getItem('subject');
      if (u) setUsername(u);
      if (d) setDarkMode(d === 'true');
      if (s) setSubject(s);
      showStatus(u ? '✅ Data loaded!' : '⚠️  No saved data found.');
    } catch { showStatus('❌ Failed to load.', true); }
    finally  { setLoading(false); }
  };

  const clearData = () => Alert.alert('Clear Data','Remove all saved preferences?',[
    { text:'Cancel', style:'cancel' },
    { text:'Clear', style:'destructive', onPress: async () => {
        setLoading(true);
        await AsyncStorage.removeItem('username');
        await AsyncStorage.removeItem('darkMode');
        await AsyncStorage.removeItem('subject');
        setUsername(''); setSubject('');
        showStatus('🗑️ Data cleared.');
        setLoading(false);
      }
    },
  ]);

  const inp = {
    backgroundColor:C.card, borderRadius:12, borderWidth:1, borderColor:C.border,
    color:C.text, fontSize:15, paddingHorizontal:16, paddingVertical:12, marginBottom:14,
  };
  const card = {
    backgroundColor:C.surface, borderRadius:16, padding:16,
    borderWidth:1, borderColor:C.border, marginBottom:16,
  };

  return (
    <ScrollView style={{flex:1, backgroundColor:C.bg}}
      contentContainerStyle={{padding:16}} showsVerticalScrollIndicator={false}>
      <Text style={{fontSize:22, fontWeight:'800', color:C.text}}>Settings ⚙️</Text>
      <Text style={{fontSize:13, color:C.textSec, marginBottom:20, marginTop:2}}>
        Preferences stored with AsyncStorage
      </Text>

      {!!status && (
        <View style={{borderWidth:1, borderRadius:12, padding:12, marginBottom:16,
          backgroundColor:C.card, borderColor:status.isErr?C.danger:C.success}}>
          <Text style={{color:status.isErr?C.danger:C.success, fontWeight:'600'}}>{status.msg}</Text>
        </View>
      )}

      {/* Profile */}
      <View style={card}>
        <Text style={{fontSize:16, fontWeight:'700', color:C.text, marginBottom:14}}>👤 Profile</Text>
        <Text style={{fontSize:13, color:C.textSec, marginBottom:6, fontWeight:'600'}}>Username</Text>
        <TextInput style={inp} placeholder="Enter your username..."
          placeholderTextColor={C.textMut} value={username} onChangeText={setUsername}/>
      </View>

      {/* Appearance */}
      <View style={card}>
        <Text style={{fontSize:16, fontWeight:'700', color:C.text, marginBottom:14}}>🎨 Appearance</Text>
        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center',
          backgroundColor:C.card, borderRadius:12, padding:14, borderWidth:1, borderColor:C.border}}>
          <View>
            <Text style={{fontSize:15, fontWeight:'600', color:C.text}}>Dark Mode</Text>
            <Text style={{fontSize:13, color:C.textSec, marginTop:2}}>
              {darkMode ? '🌙 Dark theme active' : '☀️ Light theme active'}
            </Text>
          </View>
          <Switch value={darkMode} onValueChange={setDarkMode}
            trackColor={{false:C.border, true:C.accent}} thumbColor="#fff"
            ios_backgroundColor={C.border}/>
        </View>
      </View>

      {/* Favorite Subject */}
      <View style={card}>
        <Text style={{fontSize:16, fontWeight:'700', color:C.text, marginBottom:14}}>📚 Favorite Subject</Text>
        <View style={{flexDirection:'row', flexWrap:'wrap', gap:8}}>
          {subjects.map(s => (
            <TouchableOpacity key={s} onPress={()=>setSubject(s)}
              style={{backgroundColor: subject===s ? C.accentBg : C.card,
                borderRadius:20, borderWidth:1,
                borderColor: subject===s ? C.accent : C.border,
                paddingHorizontal:14, paddingVertical:8}}>
              <Text style={{fontSize:13, fontWeight:'500',
                color: subject===s ? C.accent : C.textSec}}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!!subject && (
          <Text style={{color:C.accentSoft, fontSize:13, marginTop:10, fontWeight:'600'}}>
            Selected: {subject}
          </Text>
        )}
      </View>

      {/* Buttons */}
      <TouchableOpacity onPress={saveData} disabled={loading}
        style={{backgroundColor:C.accent, borderRadius:14, paddingVertical:15,
          alignItems:'center', marginBottom:12, opacity:loading?0.7:1}}>
        {loading
          ? <ActivityIndicator color="#fff" size="small"/>
          : <Text style={{color:'#fff', fontWeight:'700', fontSize:16}}>💾  Save Data</Text>}
      </TouchableOpacity>

      <View style={{flexDirection:'row', gap:10, marginBottom:12}}>
        <TouchableOpacity onPress={loadData} disabled={loading}
          style={{flex:1, backgroundColor:C.accentBg, borderRadius:14, borderWidth:1,
            borderColor:C.accent, paddingVertical:13, alignItems:'center'}}>
          <Text style={{color:C.accentSoft, fontWeight:'600', fontSize:15}}>📂  Load Data</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={clearData} disabled={loading}
          style={{flex:1, backgroundColor:C.isDark?'#2d0f0f':'#FEE2E2', borderRadius:14,
            borderWidth:1, borderColor:C.danger, paddingVertical:13, alignItems:'center'}}>
          <Text style={{color:C.danger, fontWeight:'600', fontSize:15}}>🗑️  Clear Data</Text>
        </TouchableOpacity>
      </View>

      <View style={{backgroundColor:C.accentBg, borderRadius:12, padding:14,
        borderWidth:1, borderColor:C.accent+'44', marginTop:4}}>
        <Text style={{fontSize:13, color:C.textSec, lineHeight:20}}>
          💡 AsyncStorage persists data locally on the device. Data survives app restarts but is stored only on this device.
        </Text>
      </View>
      <View style={{height:40}}/>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────
// BOTTOM TAB BAR
// ─────────────────────────────────────────────
function TabBar({ activeTab, onSelect }) {
  const C = useTheme();
  return (
    <View style={{flexDirection:'row', backgroundColor:C.surface,
      borderTopWidth:1, borderTopColor:C.border,
      paddingBottom:Platform.OS==='ios' ? 20 : 8, paddingTop:8}}>
      {TABS.map(tab => {
        const active = activeTab === tab.key;
        return (
          <TouchableOpacity key={tab.key} style={{flex:1, alignItems:'center', gap:3}}
            onPress={()=>onSelect(tab.key)} activeOpacity={0.7}>
            <View style={{width:40, height:32, borderRadius:16, alignItems:'center', justifyContent:'center',
              backgroundColor: active ? C.accentBg : 'transparent'}}>
              <Text style={{fontSize: active?22:20}}>{tab.icon}</Text>
            </View>
            <Text style={{fontSize:11, fontWeight:'600',
              color: active ? C.accent : C.textSec}}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────
export default function App() {
  const [phase,         setPhase]         = useState('splash');
  const [user,          setUser]          = useState(null);
  const [activeTab,     setActiveTab]     = useState('home');
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [darkMode,      setDarkMode]      = useState(true);

  const theme = darkMode ? DARK : LIGHT;

  if (phase==='splash') {
    return <SplashScreen onDone={() => setPhase('auth')}/>;
  }

  if (phase==='auth') {
    return (
      <ThemeContext.Provider value={theme}>
        <SafeAreaView style={{flex:1, backgroundColor:theme.bg}}>
          <StatusBar barStyle={darkMode?'light-content':'dark-content'} backgroundColor={theme.bg}/>
          <AuthScreen onLogin={u => { setUser(u); setPhase('main'); }}/>
        </SafeAreaView>
      </ThemeContext.Provider>
    );
  }

  if (selectedMovie) {
    return (
      <ThemeContext.Provider value={theme}>
        <SafeAreaView style={{flex:1, backgroundColor:theme.bg}}>
          <StatusBar barStyle={darkMode?'light-content':'dark-content'} backgroundColor={theme.bg}/>
          <DetailsScreen item={selectedMovie} onBack={() => setSelectedMovie(null)}/>
        </SafeAreaView>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
      <SafeAreaView style={{flex:1, backgroundColor:theme.bg}}>
        <StatusBar barStyle={darkMode?'light-content':'dark-content'} backgroundColor={theme.bg}/>
        <View style={{flex:1}}>
          {activeTab==='home' && (
            <HomeScreen
              user={user}
              onLogout={() => { setUser(null); setPhase('auth'); }}
              onNavigate={tab => setActiveTab(tab)}
            />
          )}
          {activeTab==='notes'    && <NotesScreen/>}
          {activeTab==='explore'  && <ExploreScreen onSelectMovie={setSelectedMovie}/>}
          {activeTab==='settings' && <SettingsScreen darkMode={darkMode} setDarkMode={setDarkMode}/>}
        </View>
        <TabBar activeTab={activeTab} onSelect={setActiveTab}/>
      </SafeAreaView>
    </ThemeContext.Provider>
  );
}
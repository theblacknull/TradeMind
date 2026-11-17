import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './utils/ProtectedRoute';
import Home from './components/Home/Home';
import ProfilePage from './components/ProfilePage/ProfilePage';
import ReportPage from './components/ReportPage/ReportPage';
import ChatBubble from './components/AssistantChat/ChatBubble';
import AssistantPage from './components/AssistantChat/AssistantPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/profile" element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        } />
        <Route path="/report" element={
          <ProtectedRoute>
            <ReportPage />
          </ProtectedRoute>
        } />
      </Routes>
      <ChatBubble />
    </Router>
  );
}

export default App;
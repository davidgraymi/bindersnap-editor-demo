import { DemoEditor } from './components/Editor';
import "./index.css";
import React, { useState } from 'react';

export function App() {
  const [content, setContent] = useState('');

  const handleChange = (html: string) => {
    setContent(html);
  };

  const handleContentUpdate = (newContent: string) => {
    setContent(newContent);
  };


  const sampleContent = `
    <h1>Welcome to the Rich Text Editor</h1>
    <p>This is a fully-featured <strong>TipTap</strong> editor with a <em>Google Docs-like</em> toolbar. Try out all the formatting options!</p>
    
    <h2>Features</h2>
    <ul>
      <li><strong>Text Formatting</strong>: Bold, italic, underline, strikethrough, subscript, and superscript</li>
      <li><strong>Font Options</strong>: Choose from multiple font families and sizes</li>
      <li><strong>Colors</strong>: Add text color and highlight to your content</li>
      <li><strong>Alignment</strong>: Left, center, right, and justify alignment</li>
      <li><strong>Lists</strong>: Bullet lists, numbered lists, and checklists</li>
    </ul>

    <h2>Code Example</h2>
    <pre><code>function greet(name) {
  return \`Hello, \${name}!\`;
}</code></pre>

    <h2>Blockquote</h2>
    <blockquote>
      <p>"The only way to do great work is to love what you do." — Steve Jobs</p>
    </blockquote>

    <h2>Task List</h2>
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="true">Complete the editor demo</li>
      <li data-type="taskItem" data-checked="false">Add more features</li>
      <li data-type="taskItem" data-checked="false">Write documentation</li>
    </ul>

    <p>Start editing to see the changes in real-time!</p>
  `;

  // Initialize content on first load if empty
  React.useEffect(() => {
    if (!content) setContent(sampleContent);
  }, []);


  return (
    <div className="app">
      <div className="app-header">
        <h1>Rich Text Editor Demo</h1>
        <p>A TipTap-powered editor with Google Docs-like features</p>
      </div>
      
      <div className="editor-demo-container">
        <DemoEditor 
          initialContent={content}
          onChange={handleChange}
          placeholder="Start typing your document..."
        />
      </div>
    </div>
  );
}

export default App;

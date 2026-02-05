import React, { useState, useEffect } from 'react';
import { listFiles, saveDocument } from './FileSystem';

export default function FileTree({ projectName, currentDoc, onSelectDoc }) {
  const [files, setFiles] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const refreshFiles = async () => {
    const list = await listFiles(projectName);
    setFiles(list);
  };

  useEffect(() => { refreshFiles(); }, [projectName]);

  const confirmNewFile = async () => {
    if (newName.trim()) {
      await saveDocument(projectName, newName, { type: 'doc', content: [] });
      setNewName('');
      setIsAdding(false);
      await refreshFiles();
      onSelectDoc(newName);
    }
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header" style={{ display: 'flex', justifyContent: 'space-between', padding: '10px' }}>
        <span>{projectName}</span>
        <button onClick={() => setIsAdding(true)}>+</button>
      </div>

      {isAdding && (
        <div className="new-file-input" style={{ padding: '5px 10px' }}>
          <input 
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmNewFile()}
            onBlur={() => setIsAdding(false)}
            placeholder="File name..."
            style={{ width: '100%', background: '#333', color: 'white', border: '1px solid #555' }}
          />
        </div>
      )}

      <div className="file-list">
        {files.map(file => (
          <div 
            key={file} 
            className={`file-item ${currentDoc === file ? 'active' : ''}`}
            // CRITICAL: This allows the useEditorContextMenu hook to find the name
            data-filename={file} 
            onClick={() => onSelectDoc(file)}
            style={{ 
              padding: '5px 10px', 
              cursor: 'pointer', 
              borderRadius: '10px', 
              backgroundColor: currentDoc === file ? '#3a3a3a' : 'transparent' 
            }}
          >
            📄 {file}
          </div>
        ))}
      </div>
      
      {/* LOCAL MODAL REMOVED - The native menu now handles this */}
    </div>
  );
}
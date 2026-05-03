import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Moon, Sun, Undo, Redo, CheckCircle } from 'lucide-react';

interface FileEntry {
  path: string;
  handle: FileSystemFileHandle;
}

function extractLinks(text: string): string[] {
  const links = new Set<string>();
  const regex = /\[\[(.*?)\]\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const link = match[1].split('|')[0].trim();
    if (link) links.add(link);
  }
  return Array.from(links);
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isSaved, setIsSaved] = useState(true);
  const [workspaceFiles, setWorkspaceFiles] = useState<FileEntry[]>([]);
  const workspaceFilesRef = useRef<FileEntry[]>([]);
  const [currentFileHandle, setCurrentFileHandleState] = useState<FileSystemFileHandle | null>(null);
  const currentFileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [workspaceDirHandle, setWorkspaceDirHandle] = useState<any>(null);
  const workspaceDirHandleRef = useRef<any>(null);
  const [status, setStatus] = useState<string>('Ready');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const checkLinksTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const undoStackRef = useRef<{text: string, selectionStart: number, selectionEnd: number}[]>([]);
  const redoStackRef = useRef<{text: string, selectionStart: number, selectionEnd: number}[]>([]);
  const historyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // History state
  const [history, setHistory] = useState<FileSystemFileHandle[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Dropdown state
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchingPages, setMatchingPages] = useState<string[]>([]);
  const [dropdownIndex, setDropdownIndex] = useState(0);

  const updateFiles = (files: FileEntry[]) => {
    workspaceFilesRef.current = files;
    setWorkspaceFiles([...files]);
  };

  const setDirHandleState = (handle: any) => {
    workspaceDirHandleRef.current = handle;
    setWorkspaceDirHandle(handle);
  };

  const setCurrentFileHandle = (handle: FileSystemFileHandle | null) => {
    currentFileHandleRef.current = handle;
    setCurrentFileHandleState(handle);
  };

  const autoSave = async () => {
    const handle = currentFileHandleRef.current;
    if (!handle || !textAreaRef.current) return;
    try {
      const writable = await (handle as any).createWritable();
      const text = textAreaRef.current.value;
      await writable.write(text);
      await writable.close();
      const file = await handle.getFile();
      lastSyncTimeRef.current = file.lastModified;
      setStatus(`Auto-saved ${handle.name}`);
      setIsSaved(true);
    } catch (err: any) {
      console.error('Auto-save error:', err);
    }
  };

  // Periodic auto-save every 2 minutes
  useEffect(() => {
    const interval = setInterval(autoSave, 120000);
    return () => clearInterval(interval);
  }, []);

  // External file modification poller
  useEffect(() => {
    const checkExternalChanges = async () => {
      const handle = currentFileHandleRef.current;
      if (!handle || !textAreaRef.current) return;
      try {
        const file = await handle.getFile();
        if (file.lastModified > lastSyncTimeRef.current + 1000) {
           const text = await file.text();
           const cursor = textAreaRef.current.selectionStart;
           textAreaRef.current.value = text;
           textAreaRef.current.setSelectionRange(cursor, cursor);
           lastSyncTimeRef.current = file.lastModified;
           setStatus(`Reloaded ${file.name} from external changes.`);
        }
      } catch (e) {
        // ignore
      }
    };
    const interval = setInterval(checkExternalChanges, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenFolder = async () => {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      setDirHandleState(dirHandle);
      setStatus('Indexing Graph...');
      
      const files = await getFilesRecursively(dirHandle);
      updateFiles(files);
      
      setStatus('Parsing files for links...');
      const allLinks = new Set<string>();
      
      for (const entry of files) {
        if (entry.path.endsWith('.md')) {
          try {
            const file = await entry.handle.getFile();
            const text = await file.text();
            extractLinks(text).forEach(l => allLinks.add(l));
          } catch(e) {}
        }
      }
      
      setStatus('Creating missing pages...');
      const currentPages = new Set(files.map(f => {
        const parts = f.path.split('/');
        return parts[parts.length-1].replace(/\.md$/i, '').toLowerCase();
      }));
      
      let pagesDirHandle: any = null;
      let newFilesCreated = 0;
      
      for (const link of allLinks) {
         if (!currentPages.has(link.toLowerCase())) {
            if (!pagesDirHandle) {
               try {
                 pagesDirHandle = await dirHandle.getDirectoryHandle('pages', { create: true });
               } catch(e) {
                 pagesDirHandle = dirHandle;
               }
            }
            try {
               const newFileHandle = await pagesDirHandle.getFileHandle(`${link}.md`, { create: true });
               files.push({ path: `pages/${link}.md`, handle: newFileHandle });
               currentPages.add(link.toLowerCase());
               newFilesCreated++;
            } catch(e) {
               console.error("Failed to create", link, e);
            }
         }
      }
      
      setStatus(`Loading daily journal...`);
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const journalName = `${yyyy}_${mm}_${dd}`;
      
      let journalsDirHandle: any = null;
      try {
        journalsDirHandle = await dirHandle.getDirectoryHandle('journals', { create: true });
      } catch(e) {
        journalsDirHandle = dirHandle;
      }
      
      let journalFileHandle: any = null;
      try {
        journalFileHandle = await journalsDirHandle.getFileHandle(`${journalName}.md`, { create: true });
        const newEntry = { path: `journals/${journalName}.md`, handle: journalFileHandle };
        if (!files.find(f => f.path === newEntry.path)) {
          files.push(newEntry);
        }
      } catch(e) {
        console.error("Failed to create journal", e);
      }
      
      updateFiles(files);
      setStatus(`Loaded ${files.length} files. Created ${newFilesCreated} missing pages.`);
      
      if (journalFileHandle) {
         await openFile(journalFileHandle);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStatus(`Error: ${err.message}`);
      } else {
        setStatus('Ready');
      }
    }
  };

  const ensureLinkExists = async (link: string) => {
    const dirHandle = workspaceDirHandleRef.current;
    if (!dirHandle) return;
    const cleanLink = link.trim();
    if (!cleanLink) return;
    const lowerClean = cleanLink.toLowerCase();
    
    const exists = workspaceFilesRef.current.some(f => {
      const p = f.path.toLowerCase();
      return p.endsWith(`/${lowerClean}.md`) || p === `${lowerClean}.md` || p.endsWith(`/${lowerClean}`) || p === lowerClean;
    });
    
    if (!exists) {
      try {
        let pagesDirHandle;
        try {
          pagesDirHandle = await dirHandle.getDirectoryHandle('pages', { create: true });
        } catch(e) {
          pagesDirHandle = dirHandle;
        }
        const newFileHandle = await pagesDirHandle.getFileHandle(`${cleanLink}.md`, { create: true });
        const newEntry = { path: `pages/${cleanLink}.md`, handle: newFileHandle };
        
        updateFiles([...workspaceFilesRef.current, newEntry]);
        setStatus(`Created missing page: ${cleanLink}.md`);
      } catch (e: any) {
        console.error(e);
      }
    }
  };

  const openFile = async (fileHandle: FileSystemFileHandle, addToHistory = true) => {
    if (currentFileHandleRef.current && textAreaRef.current) {
      await autoSave();
    }
    try {
      const file = await fileHandle.getFile();
      let text = await file.text();
      setCurrentFileHandle(fileHandle);
      
      let wasEmpty = false;
      if (text.trim() === '') {
        text = '- ';
        wasEmpty = true;
      }
      
      if (textAreaRef.current) {
        textAreaRef.current.value = text;
      }
      lastSyncTimeRef.current = file.lastModified;
      setStatus(`Opened ${file.name}`);
      setIsSaved(true);
      undoStackRef.current = [{ text, selectionStart: 0, selectionEnd: 0 }];
      redoStackRef.current = [];
      
      if (wasEmpty) {
        autoSave();
      }
      
      if (addToHistory) {
         const newHistory = history.slice(0, historyIndex + 1);
         newHistory.push(fileHandle);
         setHistory(newHistory);
         setHistoryIndex(newHistory.length - 1);
      }
    } catch (err: any) {
      setStatus(`Error opening file: ${err.message}`);
    }
  };

  const goBack = async () => {
     if (historyIndex > 0) {
        const prev = history[historyIndex - 1];
        setHistoryIndex(historyIndex - 1);
        await openFile(prev, false);
     }
  };

  const goForward = async () => {
     if (historyIndex < history.length - 1) {
        const next = history[historyIndex + 1];
        setHistoryIndex(historyIndex + 1);
        await openFile(next, false);
     }
  };

  const handleSave = async () => {
    if (!currentFileHandle) return;
    try {
      const writable = await (currentFileHandle as any).createWritable();
      const text = textAreaRef.current?.value || '';
      await writable.write(text);
      await writable.close();
      setStatus(`Saved ${currentFileHandle.name}`);
      setIsSaved(true);
      
      const links = extractLinks(text);
      for (const l of links) {
         await ensureLinkExists(l);
      }
    } catch (err: any) {
      setStatus(`Error saving file: ${err.message}`);
    }
  };

  const saveState = () => {
      if (!textAreaRef.current) return;
      const text = textAreaRef.current.value;
      const start = textAreaRef.current.selectionStart;
      const end = textAreaRef.current.selectionEnd;
      
      const stack = undoStackRef.current;
      if (stack.length > 0 && stack[stack.length - 1].text === text) {
          stack[stack.length - 1].selectionStart = start;
          stack[stack.length - 1].selectionEnd = end;
          return;
      }
      
      stack.push({ text, selectionStart: start, selectionEnd: end });
      if (stack.length > 200) stack.shift();
      redoStackRef.current = [];
  };

  const handleUndo = () => {
      if (!textAreaRef.current) return;
      const currentText = textAreaRef.current.value;
      const currentStart = textAreaRef.current.selectionStart;
      const currentEnd = textAreaRef.current.selectionEnd;
      
      if (undoStackRef.current.length > 0) {
          redoStackRef.current.push({ text: currentText, selectionStart: currentStart, selectionEnd: currentEnd });
          
          let prev = undoStackRef.current.pop();
          while (prev && prev.text === currentText && undoStackRef.current.length > 0) {
              prev = undoStackRef.current.pop();
          }
          
          if (prev && prev.text !== currentText) {
              textAreaRef.current.value = prev.text;
              textAreaRef.current.setSelectionRange(prev.selectionStart, prev.selectionEnd);
              handleTextChange(undefined, true);
          } else if (prev) {
              undoStackRef.current.push(prev);
          }
      }
  };

  const handleRedo = () => {
      if (!textAreaRef.current) return;
      if (redoStackRef.current.length > 0) {
          const currentText = textAreaRef.current.value;
          const currentStart = textAreaRef.current.selectionStart;
          const currentEnd = textAreaRef.current.selectionEnd;
          
          undoStackRef.current.push({ text: currentText, selectionStart: currentStart, selectionEnd: currentEnd });
          
          const next = redoStackRef.current.pop()!;
          textAreaRef.current.value = next.text;
          textAreaRef.current.setSelectionRange(next.selectionStart, next.selectionEnd);
          handleTextChange(undefined, true);
      }
  };

  const getLinkAtCursor = (text: string, cursorPosition: number): string | null => {
    const CHUNK_SIZE = 500;
    const startIdx = Math.max(0, cursorPosition - CHUNK_SIZE);
    const endIdx = Math.min(text.length, cursorPosition + CHUNK_SIZE);
    
    const chunk = text.substring(startIdx, endIdx);
    const cursorInChunk = cursorPosition - startIdx;
    
    const regex = /\[\[(.*?)\]\]/g;
    let match;
    while ((match = regex.exec(chunk)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursorInChunk >= start && cursorInChunk <= end) {
        return match[1];
      }
    }
    return null;
  };

  const handleTextChange = (e?: React.ChangeEvent<HTMLTextAreaElement>, skipHistory = false) => {
    const text = textAreaRef.current?.value || '';
    const cursor = textAreaRef.current?.selectionStart || 0;
    
    setIsSaved(false);

    if (!skipHistory) {
      if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
      historyTimeoutRef.current = setTimeout(() => {
        saveState();
      }, 500);
    }
    
    const textBeforeCursor = text.substring(0, cursor);
    const lastOpenBracket = textBeforeCursor.lastIndexOf('[[');
    const lastCloseBracket = textBeforeCursor.lastIndexOf(']]');
    const newlineAfterOpen = textBeforeCursor.indexOf('\n', lastOpenBracket);

    // If we are currently typing inside a [[link
    if (lastOpenBracket !== -1 && lastOpenBracket > lastCloseBracket && (newlineAfterOpen === -1 || newlineAfterOpen >= cursor)) {
       const query = textBeforeCursor.substring(lastOpenBracket + 2);
       setSearchQuery(query);
       setDropdownVisible(true);
       
       const lowerQ = query.toLowerCase();
       const allPageNames = Array.from(new Set(workspaceFilesRef.current.map(f => {
          const parts = f.path.split('/');
          return parts[parts.length - 1].replace(/\.md$/i, '');
       })));
       
       const matches = allPageNames.filter(n => n.toLowerCase().includes(lowerQ)).slice(0, 10);
       setMatchingPages(matches);
       setDropdownIndex(0);
    } else {
       setDropdownVisible(false);
    }

    if (checkLinksTimeoutRef.current) clearTimeout(checkLinksTimeoutRef.current);
    checkLinksTimeoutRef.current = setTimeout(async () => {
      if (!textAreaRef.current || !workspaceDirHandleRef.current) return;
      const links = extractLinks(text);
      for (const l of links) {
        await ensureLinkExists(l);
      }
    }, 1500);

    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(autoSave, 500);
  };

  const insertSelectedLink = (pageName: string) => {
    const textarea = textAreaRef.current;
    if (!textarea) return;
    saveState();
    const text = textarea.value;
    const cursor = textarea.selectionStart;
    
    const textBeforeCursor = text.substring(0, cursor);
    const lastOpenBracket = textBeforeCursor.lastIndexOf('[[');
    
    const newText = text.substring(0, lastOpenBracket + 2) + pageName + ']]' + text.substring(cursor);
    textarea.value = newText;
    
    const newCursor = lastOpenBracket + 2 + pageName.length + 2;
    textarea.setSelectionRange(newCursor, newCursor);
    
    setDropdownVisible(false);
    saveState();
    handleTextChange(undefined, true); 
    autoSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
     if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
       e.preventDefault();
       if (e.shiftKey) {
         handleRedo();
       } else {
         handleUndo();
       }
       return;
     }
     if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
       e.preventDefault();
       handleRedo();
       return;
     }

     if (dropdownVisible) {
        if (e.key === 'ArrowDown') {
           e.preventDefault();
           setDropdownIndex(i => Math.min(i + 1, Math.max(0, matchingPages.length - 1)));
           return;
        } else if (e.key === 'ArrowUp') {
           e.preventDefault();
           setDropdownIndex(i => Math.max(i - 1, 0));
           return;
        } else if (e.key === 'Enter') {
           e.preventDefault();
           if (matchingPages.length > 0) {
              insertSelectedLink(matchingPages[dropdownIndex]);
           } else if (searchQuery.trim().length > 0) {
              insertSelectedLink(searchQuery.trim());
           }
           return;
        } else if (e.key === 'Escape') {
           e.preventDefault();
           setDropdownVisible(false);
           return;
        }
     }

     const textarea = e.currentTarget;
     const text = textarea.value;
     const cursorStart = textarea.selectionStart;
     const cursorEnd = textarea.selectionEnd;

     if (cursorStart === cursorEnd) {
       const cursor = cursorStart;
       const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
       const lineEnd = text.indexOf('\n', cursor);
       const actualLineEnd = lineEnd === -1 ? text.length : lineEnd;
       const currentLine = text.substring(lineStart, actualLineEnd);

       const blockMatch = currentLine.match(/^(\s*)-\s/);

       if (e.key === 'Enter') {
         e.preventDefault();
         saveState();
         if (blockMatch) {
           const indent = blockMatch[1];
           const isBlockEmpty = currentLine.substring(blockMatch[0].length).trim() === '';
           
           if (isBlockEmpty && indent.length > 0) {
              const newIndentLength = Math.max(0, indent.length - 2);
              const newIndent = ' '.repeat(newIndentLength);
              const newText = text.substring(0, lineStart) + newIndent + '- ' + text.substring(actualLineEnd);
              textarea.value = newText;
              const newCursor = lineStart + newIndent.length + 2;
              textarea.setSelectionRange(newCursor, newCursor);
           } else {
              const prefix = `\n${indent}- `;
              const newText = text.substring(0, cursor) + prefix + text.substring(cursor);
              textarea.value = newText;
              const newCursor = cursor + prefix.length;
              textarea.setSelectionRange(newCursor, newCursor);
           }
         } else {
             const prefix = `\n- `;
             const newText = text.substring(0, cursor) + prefix + text.substring(cursor);
             textarea.value = newText;
             const newCursor = cursor + prefix.length;
             textarea.setSelectionRange(newCursor, newCursor);
         }
         saveState();
         handleTextChange(undefined, true);
       } else if (e.key === 'Tab') {
         e.preventDefault();
         saveState();
         if (blockMatch) {
            const currentIndentLen = blockMatch[1].length;
            
            let blockExtentEnd = actualLineEnd;
            let nextLineStart = actualLineEnd + 1;
            while (nextLineStart < text.length) {
                let nextLineEnd = text.indexOf('\n', nextLineStart);
                if (nextLineEnd === -1) nextLineEnd = text.length;
                let nextLine = text.substring(nextLineStart, nextLineEnd);
                
                if (nextLine.trim() !== '') {
                    let nextSpaceMatch = nextLine.match(/^(\s*)/);
                    let nextIndent = nextSpaceMatch ? nextSpaceMatch[1].length : 0;
                    if (nextIndent <= currentIndentLen) {
                        break;
                    }
                } else {
                    break;
                }
                
                blockExtentEnd = nextLineEnd;
                nextLineStart = nextLineEnd + 1;
            }
            
            const extentText = text.substring(lineStart, blockExtentEnd);
            const extentLines = extentText.split('\n');

            if (e.shiftKey) {
                if (currentIndentLen >= 2) {
                    const newExtentLines = extentLines.map(l => {
                        if (l.startsWith('  ')) return l.substring(2);
                        if (l.startsWith(' ')) return l.substring(1);
                        return l;
                    });
                    const newText = text.substring(0, lineStart) + newExtentLines.join('\n') + text.substring(blockExtentEnd);
                    textarea.value = newText;
                    const newCursor = Math.max(lineStart, cursor - 2);
                    textarea.setSelectionRange(newCursor, newCursor);
                    saveState();
                    handleTextChange(undefined, true);
                }
            } else {
                if (lineStart > 0) {
                    const prevLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
                    const prevLine = text.substring(prevLineStart, lineStart - 1);
                    const prevBlockMatch = prevLine.match(/^(\s*)-\s/);
                    
                    const maxIndent = prevBlockMatch ? prevBlockMatch[1].length + 2 : (prevLine.trim() === '' ? 0 : 2);
                    
                    if (currentIndentLen < maxIndent) {
                        const newExtentLines = extentLines.map(l => '  ' + l);
                        const newText = text.substring(0, lineStart) + newExtentLines.join('\n') + text.substring(blockExtentEnd);
                        textarea.value = newText;
                        const newCursor = cursor + 2;
                        textarea.setSelectionRange(newCursor, newCursor);
                        saveState();
                        handleTextChange(undefined, true);
                    }
                }
            }
         } else {
             if (!e.shiftKey) {
                 const newText = text.substring(0, cursor) + '  ' + text.substring(cursor);
                 textarea.value = newText;
                 const newCursor = cursor + 2;
                 textarea.setSelectionRange(newCursor, newCursor);
                 saveState();
                 handleTextChange(undefined, true);
             }
         }
       } else if (e.key === 'Backspace') {
         if (blockMatch && cursor === lineStart + blockMatch[0].length) {
           if (lineStart > 0) {
              e.preventDefault();
              saveState();
              const prevLineEnd = lineStart - 1;
              const contentToAppend = currentLine.substring(blockMatch[0].length);
              const newText = text.substring(0, prevLineEnd) + contentToAppend + text.substring(actualLineEnd);
              textarea.value = newText;
              textarea.setSelectionRange(prevLineEnd, prevLineEnd);
              saveState();
              handleTextChange(undefined, true);
           }
         }
       } else if (e.key === 'ArrowLeft') {
         if (blockMatch && cursor === lineStart + blockMatch[0].length) {
           if (lineStart > 0) {
             e.preventDefault();
             const prevLineEnd = lineStart - 1;
             textarea.setSelectionRange(prevLineEnd, prevLineEnd);
           }
         }
       } else if (e.key === 'ArrowRight') {
         if (cursor === actualLineEnd) {
           if (actualLineEnd < text.length) {
             e.preventDefault();
             const nextLineStart = actualLineEnd + 1;
             const nextLineEnd = text.indexOf('\n', nextLineStart);
             const nextActualLineEnd = nextLineEnd === -1 ? text.length : nextLineEnd;
             const nextLine = text.substring(nextLineStart, nextActualLineEnd);
             const nextBlockMatch = nextLine.match(/^(\s*)-\s/);
             let newCursor = nextLineStart;
             if (nextBlockMatch) {
               newCursor += nextBlockMatch[0].length;
             }
             textarea.setSelectionRange(newCursor, newCursor);
           }
         }
       }
     }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const cursorPosition = textarea.selectionStart;
    const text = textarea.value;
    const link = getLinkAtCursor(text, cursorPosition);
    
    if (link) {
      followLink(link);
    }
  };

  const followLink = async (linkText: string) => {
    if (!workspaceDirHandleRef.current && workspaceFiles.length === 0) {
      setStatus('Please order a Graph first to follow links.');
      return;
    }

    const cleanLink = linkText.split('|')[0].trim();
    const lowerClean = cleanLink.toLowerCase();
    
    if (workspaceDirHandleRef.current) {
      await ensureLinkExists(cleanLink);
    }

    let targetFile = workspaceFilesRef.current.find(f => {
      const p = f.path.toLowerCase();
      return p.endsWith(`/${lowerClean}.md`) || p === `${lowerClean}.md` || p.endsWith(`/${lowerClean}`) || p === lowerClean;
    });

    if (targetFile) {
      await openFile(targetFile.handle);
    } else {
      setStatus(`Could not find "${cleanLink}" in the Graph.`);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        autoSave();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  if (!workspaceDirHandle) {
    return (
      <div className={`flex flex-col items-center justify-center h-screen w-full font-sans transition-colors ${theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
        <div className={`p-8 border rounded-xl shadow-lg flex flex-col items-center max-w-md w-full text-center ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <img src="https://cdn-icons-png.flaticon.com/512/732/732220.png" alt="FastPad" className="w-16 h-16 mb-6 opacity-80" />
            <h1 className="text-2xl font-bold mb-2">FastPad</h1>
            <p className={`mb-8 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>A fast, Logseq-compatible offline notepad.</p>
            <button 
                onClick={handleOpenFolder} 
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors shadow-sm cursor-pointer"
            >
              Open Graph
            </button>
            <p className={`mt-4 text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>{status}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-screen w-full font-sans overflow-hidden transition-colors ${theme === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-black'}`}>
      <div className={`flex items-center space-x-2 px-2 py-1 border-b text-sm shadow-sm select-none transition-colors ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-700'}`}>
        
        <div className={`flex items-center space-x-1 border-r pr-2 mr-1 ${theme === 'dark' ? 'border-gray-600' : 'border-gray-300'}`}>
          <button 
            onClick={goBack} 
            disabled={historyIndex <= 0}
            className={`p-1 rounded disabled:opacity-30 transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
          >
            <ArrowLeft size={16} />
          </button>
          <button 
            onClick={goForward} 
            disabled={historyIndex >= history.length - 1}
            className={`p-1 rounded disabled:opacity-30 transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
          >
            <ArrowRight size={16} />
          </button>
        </div>

        <button onClick={handleOpenFolder} className={`px-2 py-1 flex items-center justify-center rounded cursor-default focus:outline-none transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
          Switch Graph
        </button>
        <button onClick={autoSave} className={`px-2 flex items-center justify-center py-1 rounded cursor-default focus:outline-none transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
          Save
        </button>

        <div className="flex-1 flex justify-center truncate px-4">
           <span className="font-bold text-lg cursor-default">{currentFileHandle ? currentFileHandle.name : 'No file opened'}</span>
        </div>

        <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className={`p-1 rounded transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      <div className={`relative flex-1 ${theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`}>
          <textarea
            ref={textAreaRef}
            defaultValue=""
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onDoubleClick={handleDoubleClick}
            className={`absolute inset-0 w-full h-full p-4 outline-none resize-none font-mono text-base leading-relaxed overflow-y-auto transition-colors ${theme === 'dark' ? 'bg-gray-900 text-gray-200 placeholder-gray-600' : 'bg-white text-gray-900 placeholder-gray-400'}`}
            spellCheck={false}
            placeholder="Type here... [[double bracket]] to link."
          />
          
          {dropdownVisible && (
            <div className={`absolute top-10 left-1/2 transform -translate-x-1/2 w-80 border rounded-md shadow-xl overflow-hidden z-20 flex flex-col font-sans transition-colors ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
              <div className={`px-3 py-1 border-b text-xs font-semibold uppercase ${theme === 'dark' ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
                 Search for page
              </div>
              {matchingPages.length > 0 ? (
                 <div className="max-h-64 overflow-y-auto">
                    {matchingPages.map((page, idx) => (
                       <div 
                         key={idx} 
                         className={`px-3 py-2 cursor-pointer border-b last:border-b-0 text-sm ${idx === dropdownIndex ? 'bg-blue-600 text-white' : (theme === 'dark' ? 'hover:bg-gray-700 text-gray-200 border-gray-700' : 'hover:bg-gray-50 text-gray-800 border-gray-100')}`}
                         onMouseDown={() => insertSelectedLink(page)}
                       >
                          {page}
                       </div>
                    ))}
                 </div>
              ) : (
                 <div className={`px-3 py-2 text-sm italic ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    {searchQuery.trim() ? `Create new page "${searchQuery}"` : "Type to search..."}
                 </div>
              )}
            </div>
          )}
      </div>

      <div className={`flex justify-between items-center px-4 py-1 border-t text-xs select-none shadow transition-colors ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-600'}`}>
        <div className="flex items-center space-x-3 flex-1 truncate">
          <div className={`flex items-center space-x-1 border-r pr-3 ${theme === 'dark' ? 'border-gray-600' : 'border-gray-300'}`}>
            <button onClick={handleUndo} className={`p-1 rounded transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Undo (Ctrl+Z)">
              <Undo size={14} />
            </button>
            <button onClick={handleRedo} className={`p-1 rounded transition-colors ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Redo (Ctrl+Y)">
              <Redo size={14} />
            </button>
          </div>
          <div className="flex items-center space-x-1">
             {isSaved ? <CheckCircle size={14} className="text-green-500" /> : <div className="w-2 h-2 rounded-full bg-yellow-500 ml-1"></div>}
             <span className="ml-1 opacity-80">{isSaved ? 'Saved' : 'Unsaved changes...'}</span>
          </div>
          <span className="truncate ml-4">{status}</span>
        </div>
      </div>
    </div>
  );
}

async function getFilesRecursively(directoryHandle: any, currentPath = ''): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  try {
    for await (const entry of directoryHandle.values()) {
      if (entry.kind === 'file') {
        files.push({ path: currentPath + entry.name, handle: entry });
      } else if (entry.kind === 'directory') {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.obsidian' || entry.name === 'logseq') continue;
        const nestedFiles = await getFilesRecursively(entry, currentPath + entry.name + '/');
        files.push(...nestedFiles);
      }
    }
  } catch (e) {
    console.error(e);
  }
  return files;
}

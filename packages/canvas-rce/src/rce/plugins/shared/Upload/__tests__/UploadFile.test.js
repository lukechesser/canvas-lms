/*
 * Copyright (C) 2019 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import React from 'react'
import {render, fireEvent, act, waitForElement, prettyDOM} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {UploadFile, handleSubmit} from '../UploadFile'

describe('UploadFile', () => {
  let trayProps;
  let fakeEditor;
  beforeEach(() => {
    trayProps = {
      source: {
        initializeCollection () {},
        initializeUpload () {},
        initializeFlickr () {},
        initializeImages() {},
        initializeDocuments() {}
      }
    }
    fakeEditor = {}
  })
  afterEach(() => {
    trayProps = null
    fakeEditor = null
  })
  it('calls onDismiss prop when closing', () => {
    const handleDismiss = jest.fn()
    const {getAllByText} = render(
      <UploadFile label="Test" editor={fakeEditor} trayProps={trayProps} onDismiss={handleDismiss} panels={['COMPUTER', 'URL']} />
    )

    const closeBtn = getAllByText('Close')[0]
    fireEvent.click(closeBtn)
    expect(handleDismiss).toHaveBeenCalled()
  })

  it('calls handleSubmit on submit', () => {
    const handleSubmit = jest.fn()
    const handleDismiss = () => {}
    const {getByText, getByLabelText} = render(
      <UploadFile label="Test" editor={fakeEditor}  trayProps={trayProps} onDismiss={handleDismiss} onSubmit={handleSubmit} panels={['COMPUTER', 'URL']} />
    )
    // We need to make sure that a file is present, or the submit button will be disabled.
    const fakeFile = new File(['(⌐□_□)'], 'somename.png', {
      type: 'image/png',
    })
    const fileInput = getByLabelText(/click to browse your computer/, { selector: 'input'})
    Object.defineProperty(fileInput, 'files', {
      value: [fakeFile]
    })
    act(() => {
      fireEvent.change(fileInput)
    })
    const submitBtn = getByText('Submit').closest('button')
    act(() => {
      fireEvent.click(submitBtn)
    })
    expect(handleSubmit).toHaveBeenCalled()
  })

  describe('panel selection', () => {
    it('adds computer and url panels', () => {
      const {getByLabelText} = render(
        <UploadFile
        label="Test"
        editor={fakeEditor}
        trayProps={trayProps}
          onDismiss={() => {}}
          panels={['COMPUTER', 'URL']}
        />
      )

      expect(getByLabelText('Computer')).toBeInTheDocument()
      expect(getByLabelText('URL')).toBeInTheDocument()
    })

    it('adds only the computer panel', () => {
      const {getByLabelText, queryByLabelText} = render(
        <UploadFile
        label="Test"
        editor={fakeEditor}
        trayProps={trayProps}
          onDismiss={() => {}}
          panels={['COMPUTER']}
        />
      )

      expect(getByLabelText('Computer')).toBeInTheDocument()
      expect(queryByLabelText('URL')).not.toBeInTheDocument()
    })
  })

  describe('tab navigation', () => {
    it('shows the Unsplash panel when the tab is clicked', async () => {
      const { getByText, getByLabelText } = render(
        <UploadFile
          label="Test"
          editor={fakeEditor}
          trayProps={trayProps}
          onDismiss={() => {}}
          onSubmit={() => {}}
          panels={['COMPUTER', 'URL', 'UNSPLASH']}
        />
      )

      const unsplashTab = getByText('Unsplash')
      act(() => {
        userEvent.click(unsplashTab)
      })
      const searchInput = await waitForElement(() => getByLabelText('Search Term'))
      expect(searchInput).toBeVisible();
    })

    it('shows the URL panel when the tab is clicked', async () => {
      const { getByText, getByLabelText } = render(
        <UploadFile
          label="Test"
          editor={fakeEditor}
          trayProps={trayProps}
          onDismiss={() => {}}
          onSubmit={() => {}}
          panels={['COMPUTER', 'URL', 'UNSPLASH']}
        />
      )

      const urlTab = getByText('URL')
      act(() => {
        userEvent.click(urlTab)
      })
      const urlInput = await waitForElement(() => getByLabelText('URL'))
      expect(urlInput).toBeVisible();
    })

    it('shows the computer panel when the tab is clicked', async () => {
      const { getByText } = render(
        <UploadFile
          label="Test"
          editor={fakeEditor}
          trayProps={trayProps}
          onDismiss={() => {}}
          onSubmit={() => {}}
          panels={['COMPUTER', 'URL', 'UNSPLASH']}
        />
      )

      const computerTab = getByText('Computer')
      act(() => {
        userEvent.click(computerTab)
      })
      const fileDrop = await waitForElement(() => getByText(/browse your computer/))
      expect(fileDrop).toBeVisible();
    })

    it('navigates from one tab to another', async () => {
      const { getByText, getByLabelText } = render(
        <UploadFile
          label="Test"
          editor={fakeEditor}
          trayProps={trayProps}
          onDismiss={() => {}}
          onSubmit={() => {}}
          panels={['COMPUTER', 'URL', 'UNSPLASH']}
        />
      )

      const urlTab = getByText('URL')
      act(() => {
        userEvent.click(urlTab)
      })
      await waitForElement(() => getByLabelText('URL'))

      const unsplashTab = getByText('Unsplash')
      act(() => {
        userEvent.click(unsplashTab)
      })
      const searchBox = await waitForElement(() => getByLabelText('Search Term'))
      expect(searchBox).toBeVisible();
    })


  })

  describe('handleSubmit', () => {

    const fakeNode = {
      addEventListener: jest.fn()
    };
    const fakeEditor = {
      content: '',
      dom: {createHTML: (tag, {src}) => `<img src="${src}" />`},
      insertContent (content) { fakeEditor.content += content },
      selection: { getEnd () {return fakeNode  }}
    }

    beforeEach(() => {
      fakeEditor.content = ''
    })
    it('inserts image with url source when URL panel is selected', () => {
      handleSubmit(fakeEditor, 'images/*', 'URL', {fileUrl: 'http://fake/path'})
      expect(fakeEditor.content).toEqual('<img src="http://fake/path" />')
    })

    it('calls contentProps.startMediaUpload when Computer panel is selected', () => {
      const fakeMediaUpload = jest.fn()
      const fakeFile = {
        name: 'foo.png',
        size: 3000,
        type: 'image/png'
      }
      handleSubmit(fakeEditor, 'images/*', 'COMPUTER', { theFile: fakeFile}, { startMediaUpload: fakeMediaUpload })
      expect(fakeMediaUpload).toHaveBeenCalledWith("images", {
        parentFolderId: 'media',
        name: 'foo.png',
        size: 3000,
        contentType: 'image/png',
        domObject: fakeFile
      })
    })

    describe('Unsplash Panel Selected', () => {
      const fakeUnsplashData = {
        id: '123abc',
        url: 'http://instructure.com/img'
      }
      it('calls source.pingbackUnsplash', () => {
        const fakeSource = {
          pingbackUnsplash: jest.fn()
        }
        handleSubmit(fakeEditor, 'images/*', 'UNSPLASH', { unsplashData : fakeUnsplashData }, {}, fakeSource)
        expect(fakeSource.pingbackUnsplash).toHaveBeenCalledWith('123abc')
      })

      it('calls inserts an image tag with the proper URL', () => {
        const fakeSource = {
          pingbackUnsplash: () => {}
        }
        handleSubmit(fakeEditor, 'images/*', 'UNSPLASH', { unsplashData : fakeUnsplashData }, {}, fakeSource)
        expect(fakeEditor.content).toEqual('<img src="http://instructure.com/img" />')
      })
    })
  })

  describe('Disabled Submit', () => {
    let renderReturnOptions;
    let fakeOnSubmit;
    beforeEach(() => {
      fakeOnSubmit = jest.fn();
      renderReturnOptions = render(
        <UploadFile
          label="Test"
          editor={fakeEditor}
          trayProps={trayProps}
          onDismiss={() => {}}
          onSubmit={fakeOnSubmit}
          panels={['COMPUTER', 'URL', 'UNSPLASH']}
        />
      )
    })

    describe('Computer Panel', () => {
      it('disables the submit button when there is no file uploaded', () => {
        const { getByText, getByLabelText } = renderReturnOptions;
        const computerTab = getByLabelText('Computer')
        act(() => {
          userEvent.click(computerTab)
        })
        const submitBtn = getByText('Submit').closest('button')
        expect(submitBtn).toBeDisabled()
      });

      it('does not allow Enter to submit the form when no file is uploaded', () => {
        const { getByLabelText } = renderReturnOptions;
        const computerTab = getByLabelText('Computer')
        act(() => {
          userEvent.click(computerTab)
        })
        const form = getByLabelText('Test')
        act(() => {
          fireEvent.keyDown(form, {keyCode: 13})
        })
        expect(fakeOnSubmit).not.toHaveBeenCalled()
      })
    })

    describe('Unsplash Panel', () => {
      it('disables the submit button when there is no unsplash image chosen', () => {
        const { getByText, getByLabelText } = renderReturnOptions;
        const unsplashTab = getByLabelText('Unsplash')
        act(() => {
          userEvent.click(unsplashTab)
        })
        const submitBtn = getByText('Submit').closest('button')
        expect(submitBtn).toBeDisabled()
      })
    })

    describe('URL Panel', () => {
      it('disables the submit button when there is no URL entered', () => {
        const { getByText, getByLabelText } = renderReturnOptions;
        const urlTab = getByLabelText('URL')
        act(() => {
          userEvent.click(urlTab)
        })
        const submitBtn = getByText('Submit').closest('button')
        expect(submitBtn).toBeDisabled()
      })
    })
  })
})

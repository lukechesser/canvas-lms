/*
 * Copyright (C) 2018 - present Instructure, Inc.
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

import * as files from "./files";
import * as images from "./images";
import Bridge from "../../bridge";
import {fileEmbed} from "../../common/mimeClass";
import {VIDEO_SIZE_OPTIONS} from '../../rce/plugins/instructure_record/VideoOptionsTray/TrayController'
import {isPreviewable} from '../../rce/plugins/shared/Previewable'

export const COMPLETE_FILE_UPLOAD = "COMPLETE_FILE_UPLOAD";
export const FAIL_FILE_UPLOAD = "FAIL_FILE_UPLOAD";
export const FAIL_FOLDERS_LOAD = "FAIL_FOLDERS_LOAD";
export const FAIL_MEDIA_UPLOAD = "FAIL_MEDIA_UPLOAD";
export const MEDIA_UPLOAD_SUCCESS = "MEDIA_UPLOAD_SUCCESS";
export const PROCESSED_FOLDER_BATCH = "PROCESSED_FOLDER_BATCH";
export const QUOTA_EXCEEDED_UPLOAD = "QUOTA_EXCEEDED_UPLOAD";
export const RECEIVE_FOLDER = "RECEIVE_FOLDER";
export const START_FILE_UPLOAD = "START_FILE_UPLOAD";
export const START_LOADING = "START_LOADING";
export const START_MEDIA_UPLOADING = "START_MEDIA_UPLOADING";
export const STOP_LOADING = "STOP_LOADING";
export const STOP_MEDIA_UPLOADING = "STOP_MEDIA_UPLOADING";
export const TOGGLE_UPLOAD_FORM = "TOGGLE_UPLOAD_FORM";

export function startLoading() {
  return { type: START_LOADING };
}

export function stopLoading() {
  return { type: STOP_LOADING };
}

export function receiveFolder({ id, name, parentId }) {
  return { type: RECEIVE_FOLDER, id, name, parentId };
}

export function failFoldersLoad(error) {
  return { type: FAIL_FOLDERS_LOAD, error };
}

export function failMediaUpload(error) {
  return { type: FAIL_MEDIA_UPLOAD, error };
}

export function mediaUploadSuccess() {
  return { type: MEDIA_UPLOAD_SUCCESS };
}

export function startUpload(fileMetaProps) {
  return { type: START_FILE_UPLOAD, file: fileMetaProps };
}

export function failUpload(error) {
  return { type: FAIL_FILE_UPLOAD, error };
}

export function quotaExceeded(error) {
  return { type: QUOTA_EXCEEDED_UPLOAD, error };
}

export function completeUpload(results) {
  return { type: COMPLETE_FILE_UPLOAD, results };
}

export function openOrCloseUploadForm() {
  return { type: TOGGLE_UPLOAD_FORM };
}

export function processedFolderBatch({ folders }) {
  return { type: PROCESSED_FOLDER_BATCH, folders };
}

export function startMediaUploading(fileMetaProps) {
  return { type: START_MEDIA_UPLOADING, payload: fileMetaProps }
}

export function stopMediaUploading() {
  return { type: STOP_MEDIA_UPLOADING }
}

export function activateMediaUpload(fileMetaProps) {
  return (dispatch) => {
    dispatch(startMediaUploading(fileMetaProps))
    Bridge.insertImagePlaceholder(fileMetaProps)
  }
}

export function removePlaceholdersFor(name) {
  return (dispatch) => {
    dispatch(stopMediaUploading())
    Bridge.removePlaceholders(name)
  }

}

export function allUploadCompleteActions(results, fileMetaProps) {
  let actions = [];
  actions.push(completeUpload(results));
  let fileProps = {
    id: results.id,
    name: results.display_name,
    url: results.preview_url,
    type: fileMetaProps.contentType,
    embed: fileEmbed(results)
  };

  actions.push(files.createAddFile(fileProps));
  actions.push(
    files.createInsertFile(fileMetaProps.parentFolderId, results.id)
  );

  if (/^image\//.test(results["content-type"])) {
    actions.push(images.createAddImage(results));
  }
  return actions;
}

export function embedUploadResult(results, selectedTabType) {
  let embedData = fileEmbed(results);

  if (
    selectedTabType == "images" &&
    embedData.type == "image" &&
    !(Bridge.existingContentToLink() && !Bridge.existingContentToLinkIsImg())
  ) {
    Bridge.insertImage(results);
  } else {
    Bridge.insertLink({
      'data-canvas-previewable': isPreviewable(results['content-type']),
      title: results.display_name,
      href: results.url,
      embed: embedData,
      target: '_blank'
    }, false);
  }
  return results;
}

// fetches the list of folders to select from when uploading a file
export function fetchFolders(bookmark) {
  return (dispatch, getState) => {
    dispatch(startLoading());
    const { source, jwt, upload, host, contextId, contextType } = getState();
    if (
      bookmark ||
      (upload.folders && Object.keys(upload.folders).length === 0)
    ) {
      return source
        .fetchFolders({ jwt, host, contextId, contextType }, bookmark)
        .then(({ folders, bookmark }) => {
          dispatch(folders.map(receiveFolder));
          const { upload } = getState();
          dispatch(processedFolderBatch(upload));
          if (bookmark) {
            dispatch(fetchFolders(bookmark));
          } else {
            dispatch(stopLoading());
          }
        })
        .catch(error => {
          dispatch(failFoldersLoad(error));
        });
    }
  };
}

function generateUploadOptions(mediatypes, sessionData) {
  const sessionDataCopy = JSON.parse(JSON.stringify(sessionData))
  delete sessionDataCopy["kaltura_setting"]
  return {
    kaltura_session: sessionDataCopy,
    allowedMediaTypes: mediatypes,
    uploadUrl: sessionData.kaltura_setting.uploadUrl,
    entryUrl: sessionData.kaltura_setting.entryUrl,
    uiconfUrl: sessionData.kaltura_setting.uiconfUrl,
    entryDefaults: {
      partnerData: sessionData.kaltura_setting.partner_data
    }
  }
}

function addUploaderReadyEventListeners(uploader, file) {
  uploader.addEventListener('K5.ready', () => {
    uploader.uploadFile(file)
  })
}

function addUploaderFileErrorEventListeners(uploader, dispatch) {
  uploader.addEventListener('K5.fileError', (error) => {
    dispatch(failMediaUpload(error));
  })
}

function addUploaderFileCompleteEventListeners(uploader, dispatch, editor, dismiss, context, source) {
  uploader.addEventListener('K5.complete', (mediaServerMediaObject) => {
    mediaServerMediaObject.contextCode = `${context.contextType}_${context.contextId}`
    mediaServerMediaObject.type = `${context.contextType}_${context.contextId}`
    source.uploadMediaToCanvas(mediaServerMediaObject).then((mediaObject) => {
      const videoElement = editor.dom.add(editor.getBody(), 'div', { 'id': `media_object_${mediaObject.media_object.media_id}` }, ' ')
      editor.dom.setStyles(videoElement, {'width': VIDEO_SIZE_OPTIONS.width, 'height': VIDEO_SIZE_OPTIONS.height})
      editor.dom.add(videoElement, 'iframe', {'src': mediaObject.embedded_iframe_url, 'width': '100%', 'height': '100%', 'scrolling': 'no'});
      dispatch(mediaUploadSuccess())
      dismiss()
    }).catch((error)=> {
      dispatch(failMediaUpload(error))
    })
  })
}

export function saveMediaRecording(file, editor, dismiss) {
  return (dispatch, getState) => {
    dispatch(startLoading())
    const { source, contextId, contextType } = getState()
    return source.mediaServerSession()
    .then((mediaServerSession) => {
      const session = generateUploadOptions(['video', 'audio', 'webm', 'video/webm', 'audio/webm'], mediaServerSession)
      Bridge.setMediaServerSession(session)
      addUploaderReadyEventListeners(Bridge.mediaServerUploader, file)
      addUploaderFileErrorEventListeners(Bridge.mediaServerUploader, dispatch)
      addUploaderFileCompleteEventListeners(Bridge.mediaServerUploader, dispatch, editor, dismiss, {contextId, contextType}, source)
      return Bridge.mediaServerUploader
    })
    .catch(error => {
      dispatch(failMediaUpload(error))
    })
  }
}

export function createMediaServerSession() {
  return (dispatch, getState) => {
    const { source } = getState()
    if(!Bridge.mediaServerSession) {
      return source.mediaServerSession()
      .then((data) => {
        Bridge.setMediaServerSession(data)
      })
    }
  }
}

export function uploadToMediaFolder(tabContext, fileMetaProps) {
  return (dispatch, getState) => {
    dispatch(activateMediaUpload(fileMetaProps))
    const { source, jwt, host, contextId, contextType } = getState()
    return source.fetchMediaFolder({ jwt, host, contextId, contextType })
    .then(({folders}) => {
      fileMetaProps.parentFolderId = folders[0].id
      delete fileMetaProps.domObject.preview // don't need this anymore
      dispatch(uploadPreflight(tabContext, fileMetaProps))
    })
  }
}

export function setUsageRights(source, fileMetaProps, results) {
  const { usageRights } = fileMetaProps;
  if (usageRights) {
    source.setUsageRights(results.id, usageRights);
  }
  return results;
}

export function getFileUrlIfMissing(source, results) {
  if (results.url) {
    return Promise.resolve(results);
  }
  return source.getFile(results.id).then(file => {
    results.url = file.url;
    return results;
  });
}

function readUploadedFileAsDataURL(file, reader = new FileReader()) {
  return new Promise((resolve, reject) => {
    reader.onerror = () => {
      reader.abort();
      reject(new DOMException("Unable to parse file"));
    };

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

export function generateThumbnailUrl(results, fileDOMObject, reader) {
  if (/^image\//.test(results["content-type"])) {
    return readUploadedFileAsDataURL(fileDOMObject, reader).then(result => {
      results.thumbnail_url = result;
      return results;
    });
  } else {
    return Promise.resolve(results);
  }
}

export function setAltText(altText, results) {
  if (altText) {
    results.alt_text = altText;
  }
  return results;
}

export function handleFailures(error, dispatch) {
  return error.response
    .json()
    .then(resp => {
      if (resp.message === "file size exceeds quota") {
        dispatch(quotaExceeded(error));
      } else {
        dispatch(failUpload(error));
      }
    })
    .catch(error => dispatch(failUpload(error)));
}

export function uploadPreflight(tabContext, fileMetaProps) {
  return (dispatch, getState) => {
    const { source, jwt, host, contextId, contextType } = getState();
    const { fileReader } = fileMetaProps;

    dispatch(startUpload(fileMetaProps));
    return source
      .preflightUpload(fileMetaProps, { jwt, host, contextId, contextType })
      .then(results => {
        return source.uploadFRD(fileMetaProps.domObject, results);
      })
      .then(results => {
        return setUsageRights(source, fileMetaProps, results);
      })
      .then(results => {
        return getFileUrlIfMissing(source, results);
      })
      .then(results => {
        return generateThumbnailUrl(
          results,
          fileMetaProps.domObject,
          fileReader
        );
      })
      .then(results => {
        return setAltText(fileMetaProps.altText, results);
      })
      .then(results => {
        // This may or may not be necessary depending on the upload
        dispatch(removePlaceholdersFor(fileMetaProps.name))
        return results
      })
      .then(results => {
        return embedUploadResult(results, tabContext);
      })
      .then(results => {
        dispatch(allUploadCompleteActions(results, fileMetaProps));
      })
      .catch(err => handleFailures(err, dispatch));
  };
}

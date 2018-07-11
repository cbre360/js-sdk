import { File } from 'tns-core-modules/file-system';
import { KinveyResponse } from '../../core/request';
import { KinveyError } from '../../core/errors';
import { FileStore as CoreFileStore } from '../../core/files';
import { KinveyWorker } from './worker';

export interface FileMetadata {
  _id?: string;
  _filename?: string;
  _public?: boolean;
  mimeType?: string;
  size?: number;
}

export interface FileUploadRequestOptions {
  count: number;
  start: number;
  timeout: number;
  maxBackoff: number;
  headers: { [key: string]: string };
}

export interface KinveyResponseConfig {
  statusCode: number;
  data?: any;
  headers?: any;
}

export class CommonFileStore extends CoreFileStore {
  upload(file: File, metadata: any, options: any);
  upload(filePath: string, metadata: any, options: any);
  upload(filePath: string | File, metadata = <any>{}, options: any) {
    if (!this.doesFileExist(filePath)) {
      return Promise.reject(new KinveyError('File does not exist'));
    }

    metadata.size = this.getFileSize(filePath);
    return super.upload(filePath, metadata, options);
  }

  protected doesFileExist(file: string | File): boolean {
    const filePath = file instanceof File ? file.path : file;
    return File.exists(filePath);
  }

  protected getFileSize(file: string | File): number {
    if (!(file instanceof File)) {
      file = File.fromPath(file);
    }

    const content = file.readSync();
    return content.length;
  }
}

export interface FileUploadWorkerOptions {
  url: string;
  metadata: FileMetadata;
  options: FileUploadRequestOptions;
  filePath: string;
}

export class FileUploadWorker extends KinveyWorker {
  upload(options: FileUploadWorkerOptions) {
    return this.postMessage(options)
      .then((responseConfig: KinveyResponseConfig) => new KinveyResponse(responseConfig));
  }
}

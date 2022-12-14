import cloudConvert from 'cloudconvert';
import {ImageConverter} from "./image-convert-command-service";
import {forEach} from "lodash";
import {ICrop} from "../interfaces/imageConverter";

export class Converter {
    private readonly cloudConvert: cloudConvert;
    private readonly s3BucketName: string;
    private readonly s3accessKeyId: string;
    private readonly s3secretAccessKey: string;
    private readonly s3EndPoint: string;
    private readonly s3Region: string;
    constructor(apiKey: string,sandbox:boolean = false, s3BucketName: string,s3Region: string, s3accessKeyId:string, s3secretAccessKey: string,s3EndPoint:string) {
        console.log("init video converter");
        this.cloudConvert = new cloudConvert(apiKey,sandbox);
        this.s3BucketName = s3BucketName;
        this.s3accessKeyId = s3accessKeyId;
        this.s3secretAccessKey = s3secretAccessKey;
        this.s3EndPoint = s3EndPoint;
        this.s3Region = s3Region;
    }

    createImageConvertTask(inputTask:string,
                      outputDir:string,
                      inputFile:string,
                      crop:{
                            x1: number;
                            y1: number;
                            x2: number;
                            y2: number;
                        }|null,
                      size:string,
                      blur:boolean){

        const inputPath:string = `/input/${inputTask}/${inputFile}`;
        const outputPath:string = `/output/${size}-${inputFile}`;
        const converter = new ImageConverter();
        const maxHeight = 2000;
        const maxWidth = 2000;

        let commands = [
            converter.src(inputPath),
            converter.autoOrient(),
            converter.autoLevel(),
            converter.colorSpace("RGB"),
            converter.strip(),
            converter.interlace("Plane"),
            converter.quality(85),
        ];

        if(crop){
            commands.push(converter.crop(crop));
        }

        commands.push(converter.rePage());

        let width = null;
        let height = null;
        switch (true) {
            case size.includes('xxx'):
                if (size.startsWith('xxx')) {
                    height = parseInt(size.replace(/xxx/g, ''));
                    if (height > maxHeight) {
                        height = maxHeight;
                    }
                } else if (size.endsWith('xxx')){
                    width = parseInt(size.replace(/xxx/g, ''));
                    if (width > maxWidth) {
                        width = maxWidth;
                    }
                }
                commands.push(converter.scale(width,height,"None"));
                commands.push(converter.rePage());
                break;
            case size.includes('x'):
                [width, height] = size.split(/x/i).map(Number);
                if (width > maxWidth) {
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    height = maxHeight;
                }
                commands.push(converter.scale(width,height,"None"));
                commands.push(converter.rePage());
                break;
            case size.includes('max'):
                height = width = parseInt(size.replace(/max/g, ''));
                commands.push(converter.scale(width,height,"None"));
                commands.push(converter.rePage());
                break;
        }

        if(blur){
            const scaleFactor = 50;
            commands.push(converter.resize(width && Math.floor(width/scaleFactor), height && Math.floor(height/scaleFactor)));
            commands.push(converter.gaussian())
            commands.push(converter.sigma(1))
            commands.push(converter.resize(width, height));
        }

        commands.push(converter.destination(outputPath))

        return {
            "operation": "command",
            "engine": "imagemagick",
            "input": inputTask,
            "command": "convert",
            "arguments": converter.getConvertString(commands),
            "engine_version": "7.1.0",
            "capture_output": true
        }
    }

    async createImages(inputFile:string, exportDir:string,crop:ICrop, sizes:string[] = ['50x50', '60x60', '68x68', '80x80', '100x100', '200x200', '400x400', '500x500', '200xxx', '340xxx', '460xxx', '660xxx', '900xxx', '1200xxx', 'xxx1080']): Promise<void> {
        const tasks:any = {};
        tasks["import-from-s3"] = {
            "operation": "import/s3",
            "bucket": this.s3BucketName,
            "endpoint": this.s3EndPoint,
            "region": this.s3Region,
            "access_key_id": this.s3accessKeyId,
            "secret_access_key": this.s3secretAccessKey,
            "key": inputFile
        }

        sizes.map(size => {
            const name = "convert-image-"+size;
            const nameBlur = "convert-image-blur-" + size;
            tasks[nameBlur] = this.createImageConvertTask("import-from-s3", exportDir, inputFile, crop, size, true);
            const fileName = `${size}.jpg`;
            const fileNameBlur = `blur/${size}.jpg`;
            tasks["export-images-to-s3-blur" + size] = {
                "operation": "export/s3",
                "bucket": this.s3BucketName,
                "endpoint": this.s3EndPoint,
                "region": this.s3Region,
                "access_key_id": this.s3accessKeyId,
                "key": `${exportDir}/${fileNameBlur}`,
                "secret_access_key": this.s3secretAccessKey,
                "input": nameBlur
            }
            tasks[name] = this.createImageConvertTask("import-from-s3",exportDir,inputFile,crop,size,false);
            tasks["export-images-to-s3"+size] = {
                "operation": "export/s3",
                "bucket": this.s3BucketName,
                "endpoint": this.s3EndPoint,
                "region": this.s3Region,
                "access_key_id": this.s3accessKeyId,
                "key": `${exportDir}/${fileName}`,
                "secret_access_key": this.s3secretAccessKey,
                "input": name
            }
        })
        let job = await this.cloudConvert.jobs.create({
            "tasks": tasks
        });
        //Wait for the task to complete
        await this.cloudConvert.jobs.wait(job.id);
    }

    async convertVideo(inputFile:string, exportDirImages:string, exportFile:string, thumbnailFile:string, sizes:string[] = ['50x50', '60x60', '68x68', '80x80', '100x100', '200x200', '400x400', '500x500', '200xxx', '340xxx', '460xxx', '660xxx', '900xxx', '1200xxx', 'xxx1080']): Promise<void> {

        let thumbnailFileName = "file.jpg";
        if(thumbnailFile) {
            const parts = thumbnailFile.split('/');
            thumbnailFileName = parts.pop() as string;
        }
        const tasks:any = {
            "import-from-s3": {
                "operation": "import/s3",
                "bucket": this.s3BucketName,
                "endpoint": this.s3EndPoint,
                "region": this.s3Region,
                "access_key_id": this.s3accessKeyId,
                "secret_access_key": this.s3secretAccessKey,
                "key": inputFile
            },
            "convert-video-from-s3": {
                "operation": "convert",
                "output_format": "mp4",
                "engine": "ffmpeg",
                "input": ["import-from-s3"],
                "video_codec": "x264",
                "vsync": 0,
                "fps": 30,
                "crf": 23,
                "preset": "slow",
                "profile": "baseline",
                "level": "1",
                "fit": "scale",
                "subtitles_mode": "none",
                "audio_codec": "aac",
                "audio_bitrate": 128,
                "engine_version": "5.1.0"
            },
            "export-video-to-s3": {
                "operation": "export/s3",
                "bucket": this.s3BucketName,
                "endpoint": this.s3EndPoint,
                "region": this.s3Region,
                "key": exportFile,
                "access_key_id": this.s3accessKeyId,
                "secret_access_key": this.s3secretAccessKey,
                "input": ["convert-video-from-s3"]
            },
            "extract-thumbnail-from-video": {
                "operation": "thumbnail",
                "input": ["convert-video-from-s3"],
                "filename": thumbnailFileName,
                "output_format": "jpg"
            },
            "export-thumbnail-to-s3": {
                "operation": "export/s3",
                "bucket": this.s3BucketName,
                "endpoint": this.s3EndPoint,
                "region": this.s3Region,
                "key":thumbnailFile,
                "access_key_id": this.s3accessKeyId,
                "secret_access_key": this.s3secretAccessKey,
                "input": "extract-thumbnail-from-video"
            }
        };
        sizes.map(size => {
            const name = "convert-image-"+size;
            const nameBlur = "convert-image-blur-" + size;
            tasks[nameBlur] = this.createImageConvertTask("extract-thumbnail-from-video", exportDirImages, thumbnailFileName, null, size, true);
            const fileName = `${size}.jpg`;
            const fileNameBlur = `blur/${size}.jpg`;
            tasks["export-images-to-s3-blur" + size] = {
                "operation": "export/s3",
                "bucket": this.s3BucketName,
                "endpoint": this.s3EndPoint,
                "region": this.s3Region,
                "access_key_id": this.s3accessKeyId,
                "key": `${exportDirImages}/${fileNameBlur}`,
                "secret_access_key": this.s3secretAccessKey,
                "input": nameBlur
            }
            tasks[name] = this.createImageConvertTask("extract-thumbnail-from-video",exportDirImages, thumbnailFileName,null,size,false);
            tasks["export-images-to-s3"+size] = {
                "operation": "export/s3",
                "bucket": this.s3BucketName,
                "endpoint": this.s3EndPoint,
                "region": this.s3Region,
                "access_key_id": this.s3accessKeyId,
                "key": `${exportDirImages}/${fileName}`,
                "secret_access_key": this.s3secretAccessKey,
                "input": name
            }
        })

        let job = await this.cloudConvert.jobs.create({
            "tasks": tasks
        });

        // Wait for the task to complete
        await this.cloudConvert.jobs.wait(job.id);
    }
}

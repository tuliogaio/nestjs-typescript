import { HttpException, HttpStatus, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection, In } from 'typeorm';
import User from './user.entity';
import CreateUserDto from './dto/createUser.dto';
import { FilesService } from '../files/files.service';
import * as bcrypt from 'bcrypt';
import StripeService from '../stripe/stripe.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly filesService: FilesService,
    private connection: Connection,
    private stripeService: StripeService
  ) {}

  async updateMonthlySubscriptionStatus(
    stripeCustomerId: string, monthlySubscriptionStatus: string
  ) {
    return this.usersRepository.update(
      { stripeCustomerId },
      { monthlySubscriptionStatus }
    );
  }

  async getByEmail(email: string) {
    const user = await this.usersRepository.findOne({ email });
    if (user) {
      return user;
    }
    throw new HttpException('User with this email does not exist', HttpStatus.NOT_FOUND);
  }

  async getByIds(ids: number[]) {
    return this.usersRepository.find({
      where: { id: In(ids) },
    });
  }

  async getById(id: number) {
    const user = await this.usersRepository.findOne({ id });
    if (user) {
      return user;
    }
    throw new HttpException('User with this id does not exist', HttpStatus.NOT_FOUND);
  }

  async create(userData: CreateUserDto) {
    const stripeCustomer = await this.stripeService.createCustomer(userData.name, userData.email);

    const newUser = await this.usersRepository.create({
      ...userData,
      stripeCustomerId: stripeCustomer.id
    });
    await this.usersRepository.save(newUser);
    return newUser;
  }

  async createWithGoogle(email: string, name: string) {
    const stripeCustomer = await this.stripeService.createCustomer(name, email);

    const newUser = await this.usersRepository.create({
      email,
      name,
      isRegisteredWithGoogle: true,
      stripeCustomerId: stripeCustomer.id
    });
    await this.usersRepository.save(newUser);
    return newUser;
  }

  async addAvatar(userId: number, imageBuffer: Buffer, filename: string) {
    const user = await this.getById(userId);
    if (user.avatar) {
      await this.usersRepository.update(userId, {
        ...user,
        avatar: null
      });
      await this.filesService.deletePublicFile(user.avatar.id);
    }
    const avatar = await this.filesService.uploadPublicFile(imageBuffer, filename);
    await this.usersRepository.update(userId, {
      ...user,
      avatar
    });
    return avatar;
  }

  async deleteAvatar(userId: number) {
    const queryRunner = this.connection.createQueryRunner();
    const user = await this.getById(userId);
    const fileId = user.avatar?.id;
    if (fileId) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        await queryRunner.manager.update(User, userId, {
          ...user,
          avatar: null
        });
        await this.filesService.deletePublicFileWithQueryRunner(fileId, queryRunner);
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw new InternalServerErrorException();
      } finally {
        await queryRunner.release();
      }
    }
  }

  async setCurrentRefreshToken(refreshToken: string, userId: number) {
    const currentHashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.usersRepository.update(userId, {
      currentHashedRefreshToken
    });
  }

  async getUserIfRefreshTokenMatches(refreshToken: string, userId: number) {
    const user = await this.getById(userId);

    const isRefreshTokenMatching = await bcrypt.compare(
      refreshToken,
      user.currentHashedRefreshToken
    );

    if (isRefreshTokenMatching) {
      return user;
    }
  }

  async markEmailAsConfirmed(email: string) {
    return this.usersRepository.update({ email }, {
      isEmailConfirmed: true
    });
  }

  markPhoneNumberAsConfirmed(userId: number) {
    return this.usersRepository.update({ id: userId }, {
      isPhoneNumberConfirmed: true
    });
  }

  async removeRefreshToken(userId: number) {
    return this.usersRepository.update(userId, {
      currentHashedRefreshToken: null
    });
  }

  async setTwoFactorAuthenticationSecret(secret: string, userId: number) {
    return this.usersRepository.update(userId, {
      twoFactorAuthenticationSecret: secret
    });
  }

  async turnOnTwoFactorAuthentication(userId: number) {
    return this.usersRepository.update(userId, {
      isTwoFactorAuthenticationEnabled: true
    });
  }
}
